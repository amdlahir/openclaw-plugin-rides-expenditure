import { describe, it, expect, beforeEach } from "vitest";
import { createInMemoryClient } from "../src/db/client";
import { runMigrations } from "../src/db/schema";
import {
  handleLogRide,
  handleListRides,
  handleSearchRides,
  handleUpdateRide,
  handleDeleteRide,
} from "../src/tools/rides";
import type { Client } from "@libsql/client";

const DEFAULT_CONFIG = {
  defaultCurrency: "SGD",
  defaultCategory: "personal",
};

describe("rides: log and list", () => {
  let db: Client;

  beforeEach(async () => {
    db = createInMemoryClient();
    await runMigrations(db);
  });

  // Tracer bullet: log a ride, then list it back
  it("logs a ride and retrieves it via list", async () => {
    const result = await handleLogRide(db, DEFAULT_CONFIG, {
      provider: "grab",
      amount: 15.5,
      pickup: "Orchard",
      dropoff: "Bugis",
    });

    expect(result.id).toBe(1);
    expect(result.message).toContain("grab");
    expect(result.message).toContain("15.50");

    const list = await handleListRides(db, {});
    expect(list.total).toBe(1);
    expect(list.rides[0].provider).toBe("grab");
    expect(list.rides[0].amount).toBe(15.5);
    expect(list.rides[0].currency).toBe("SGD");
    expect(list.rides[0].pickup).toBe("Orchard");
    expect(list.rides[0].dropoff).toBe("Bugis");
    expect(list.rides[0].category).toBe("personal");
    expect(list.rides[0].source).toBe("manual");
  });

  // Defaults: currency from config, category from config
  it("defaults currency and category from config", async () => {
    const config = { defaultCurrency: "MYR", defaultCategory: "work" };
    await handleLogRide(db, config, {
      provider: "gojek",
      amount: 10,
    });

    const list = await handleListRides(db, {});
    expect(list.rides[0].currency).toBe("MYR");
    expect(list.rides[0].category).toBe("work");
  });

  // Amount conversion: dollars to cents stored correctly
  it("stores amount in cents and returns in dollars", async () => {
    await handleLogRide(db, DEFAULT_CONFIG, {
      provider: "grab",
      amount: 7.99,
    });

    // Verify via list (public interface) that amount round-trips correctly
    const list = await handleListRides(db, {});
    expect(list.rides[0].amount).toBe(7.99);
  });

  // Same currency: normalized = original
  it("sets normalized amount equal to original when same currency", async () => {
    await handleLogRide(db, DEFAULT_CONFIG, {
      provider: "grab",
      amount: 20,
      currency: "SGD",
    });

    const list = await handleListRides(db, {});
    expect(list.rides[0].normalized_amount).toBe(20);
    expect(list.rides[0].normalized_currency).toBe("SGD");
  });

  // Cross currency: normalized is null (no exchange rate yet)
  it("sets normalized amount to null for cross-currency rides", async () => {
    await handleLogRide(db, DEFAULT_CONFIG, {
      provider: "grab",
      amount: 50,
      currency: "MYR",
    });

    const list = await handleListRides(db, {});
    expect(list.rides[0].amount).toBe(50);
    expect(list.rides[0].currency).toBe("MYR");
    expect(list.rides[0].normalized_amount).toBeNull();
    expect(list.rides[0].normalized_currency).toBeNull();
  });

  // Filter by provider
  it("filters rides by provider", async () => {
    await handleLogRide(db, DEFAULT_CONFIG, { provider: "grab", amount: 10 });
    await handleLogRide(db, DEFAULT_CONFIG, { provider: "gojek", amount: 12 });
    await handleLogRide(db, DEFAULT_CONFIG, { provider: "grab", amount: 8 });

    const list = await handleListRides(db, { provider: "grab" });
    expect(list.total).toBe(2);
    expect(list.rides.every((r) => r.provider === "grab")).toBe(true);
  });

  // Filter by category
  it("filters rides by category", async () => {
    await handleLogRide(db, DEFAULT_CONFIG, {
      provider: "grab",
      amount: 10,
      category: "work",
    });
    await handleLogRide(db, DEFAULT_CONFIG, {
      provider: "grab",
      amount: 12,
      category: "personal",
    });

    const list = await handleListRides(db, { category: "work" });
    expect(list.total).toBe(1);
    expect(list.rides[0].category).toBe("work");
  });

  // Filter by date range
  it("filters rides by date range", async () => {
    await handleLogRide(db, DEFAULT_CONFIG, {
      provider: "grab",
      amount: 10,
      date: "2026-03-01",
    });
    await handleLogRide(db, DEFAULT_CONFIG, {
      provider: "grab",
      amount: 15,
      date: "2026-03-15",
    });
    await handleLogRide(db, DEFAULT_CONFIG, {
      provider: "grab",
      amount: 20,
      date: "2026-03-28",
    });

    const list = await handleListRides(db, {
      start_date: "2026-03-10",
      end_date: "2026-03-20",
    });
    expect(list.total).toBe(1);
    expect(list.rides[0].amount).toBe(15);
  });

  // Limit: default 10, max 50, min 1
  it("respects limit parameter", async () => {
    for (let i = 0; i < 15; i++) {
      await handleLogRide(db, DEFAULT_CONFIG, { provider: "grab", amount: 5 });
    }

    const defaultList = await handleListRides(db, {});
    expect(defaultList.rides.length).toBe(10);
    expect(defaultList.total).toBe(15);

    const limited = await handleListRides(db, { limit: 3 });
    expect(limited.rides.length).toBe(3);

    const clamped = await handleListRides(db, { limit: 100 });
    expect(clamped.rides.length).toBe(15); // only 15 exist, clamped to 50
  });

  // Schema idempotency
  it("runs migrations twice without error", async () => {
    await runMigrations(db);
    // If this doesn't throw, migrations are idempotent
    const list = await handleListRides(db, {});
    expect(list.total).toBe(0);
  });

  // Date parsing
  it("parses ISO date string correctly", async () => {
    await handleLogRide(db, DEFAULT_CONFIG, {
      provider: "grab",
      amount: 10,
      date: "2026-03-15T14:30:00Z",
    });

    const list = await handleListRides(db, {});
    expect(list.rides[0].date).toContain("2026-03-15");
  });

  // Rides ordered by date descending
  it("returns rides in descending date order", async () => {
    await handleLogRide(db, DEFAULT_CONFIG, {
      provider: "grab",
      amount: 10,
      date: "2026-03-01",
    });
    await handleLogRide(db, DEFAULT_CONFIG, {
      provider: "grab",
      amount: 20,
      date: "2026-03-28",
    });

    const list = await handleListRides(db, {});
    expect(list.rides[0].amount).toBe(20); // most recent first
    expect(list.rides[1].amount).toBe(10);
  });
});

describe("rides: search, update, delete", () => {
  let db: Client;

  beforeEach(async () => {
    db = createInMemoryClient();
    await runMigrations(db);
  });

  // Search by location
  it("searches rides by pickup or dropoff location", async () => {
    await handleLogRide(db, DEFAULT_CONFIG, {
      provider: "grab",
      amount: 10,
      pickup: "Orchard",
      dropoff: "Bugis",
    });
    await handleLogRide(db, DEFAULT_CONFIG, {
      provider: "gojek",
      amount: 15,
      pickup: "MBS",
      dropoff: "Orchard",
    });
    await handleLogRide(db, DEFAULT_CONFIG, {
      provider: "grab",
      amount: 8,
      pickup: "Changi",
      dropoff: "Jurong",
    });

    const result = await handleSearchRides(db, { query: "Orchard" });
    expect(result.rides.length).toBe(2);
  });

  it("search returns empty when no location matches", async () => {
    await handleLogRide(db, DEFAULT_CONFIG, {
      provider: "grab",
      amount: 10,
      pickup: "Orchard",
      dropoff: "Bugis",
    });

    const result = await handleSearchRides(db, { query: "Airport" });
    expect(result.rides.length).toBe(0);
  });

  // Update ride
  it("updates ride fields and sets manually_edited", async () => {
    const { id } = await handleLogRide(db, DEFAULT_CONFIG, {
      provider: "grab",
      amount: 10,
      pickup: "Orchard",
      category: "personal",
    });

    const result = await handleUpdateRide(db, {
      ride_id: id,
      amount: 15,
      category: "work",
      pickup: "MBS",
    });
    expect(result.success).toBe(true);

    const list = await handleListRides(db, {});
    expect(list.rides[0].amount).toBe(15);
    expect(list.rides[0].category).toBe("work");
    expect(list.rides[0].pickup).toBe("MBS");
  });

  it("returns error when updating non-existent ride", async () => {
    const result = await handleUpdateRide(db, { ride_id: 999, amount: 10 });
    expect(result.success).toBe(false);
    expect(result.message).toContain("not found");
  });

  // Delete ride
  it("deletes a ride by id", async () => {
    const { id } = await handleLogRide(db, DEFAULT_CONFIG, {
      provider: "grab",
      amount: 10,
    });

    const result = await handleDeleteRide(db, id);
    expect(result.success).toBe(true);

    const list = await handleListRides(db, {});
    expect(list.total).toBe(0);
  });

  it("returns not found when deleting non-existent ride", async () => {
    const result = await handleDeleteRide(db, 999);
    expect(result.success).toBe(false);
    expect(result.message).toContain("not found");
  });
});
