import { describe, it, expect, beforeEach } from "vitest";
import { createInMemoryClient } from "../src/db/client";
import { runMigrations } from "../src/db/schema";
import { handleLogRide } from "../src/tools/rides";
import { handleSpendingStats } from "../src/tools/stats";
import type { Client } from "@libsql/client";

const DEFAULT_CONFIG = {
  defaultCurrency: "SGD",
  defaultCategory: "personal",
};

describe("spending statistics", () => {
  let db: Client;

  beforeEach(async () => {
    db = createInMemoryClient();
    await runMigrations(db);
  });

  it("returns totals for a date range", async () => {
    await handleLogRide(db, DEFAULT_CONFIG, {
      provider: "grab",
      amount: 10,
      date: "2026-03-15",
    });
    await handleLogRide(db, DEFAULT_CONFIG, {
      provider: "gojek",
      amount: 20,
      date: "2026-03-16",
    });

    const stats = await handleSpendingStats(db, {
      start_date: "2026-03-01",
      end_date: "2026-03-31",
    });

    expect(stats.total_amount).toBe(30);
    expect(stats.total_rides).toBe(2);
  });

  it("groups by provider", async () => {
    await handleLogRide(db, DEFAULT_CONFIG, {
      provider: "grab",
      amount: 10,
      date: "2026-03-15",
    });
    await handleLogRide(db, DEFAULT_CONFIG, {
      provider: "grab",
      amount: 5,
      date: "2026-03-16",
    });
    await handleLogRide(db, DEFAULT_CONFIG, {
      provider: "gojek",
      amount: 20,
      date: "2026-03-17",
    });

    const stats = await handleSpendingStats(db, {
      start_date: "2026-03-01",
      end_date: "2026-03-31",
      group_by: "provider",
    });

    expect(stats.breakdown.length).toBe(2);
    const grab = stats.breakdown.find((b) => b.group === "grab");
    const gojek = stats.breakdown.find((b) => b.group === "gojek");
    expect(grab?.amount).toBe(15);
    expect(grab?.count).toBe(2);
    expect(gojek?.amount).toBe(20);
    expect(gojek?.count).toBe(1);
  });

  it("groups by category", async () => {
    await handleLogRide(db, DEFAULT_CONFIG, {
      provider: "grab",
      amount: 10,
      date: "2026-03-15",
      category: "work",
    });
    await handleLogRide(db, DEFAULT_CONFIG, {
      provider: "grab",
      amount: 15,
      date: "2026-03-16",
      category: "personal",
    });

    const stats = await handleSpendingStats(db, {
      start_date: "2026-03-01",
      end_date: "2026-03-31",
      group_by: "category",
    });

    expect(stats.breakdown.length).toBe(2);
    const work = stats.breakdown.find((b) => b.group === "work");
    const personal = stats.breakdown.find((b) => b.group === "personal");
    expect(work?.amount).toBe(10);
    expect(personal?.amount).toBe(15);
  });

  it("groups by month", async () => {
    await handleLogRide(db, DEFAULT_CONFIG, {
      provider: "grab",
      amount: 10,
      date: "2026-02-15",
    });
    await handleLogRide(db, DEFAULT_CONFIG, {
      provider: "grab",
      amount: 20,
      date: "2026-03-15",
    });

    const stats = await handleSpendingStats(db, {
      start_date: "2026-01-01",
      end_date: "2026-12-31",
      group_by: "month",
    });

    expect(stats.breakdown.length).toBe(2);
    const feb = stats.breakdown.find((b) => b.group === "2026-02");
    const mar = stats.breakdown.find((b) => b.group === "2026-03");
    expect(feb?.amount).toBe(10);
    expect(mar?.amount).toBe(20);
  });

  it("returns zeros for empty date range", async () => {
    const stats = await handleSpendingStats(db, {
      start_date: "2026-03-01",
      end_date: "2026-03-31",
    });

    expect(stats.total_amount).toBe(0);
    expect(stats.total_rides).toBe(0);
    expect(stats.breakdown.length).toBe(0);
  });

  it("excludes rides with null normalized_amount", async () => {
    // Same currency ride — has normalized_amount
    await handleLogRide(db, DEFAULT_CONFIG, {
      provider: "grab",
      amount: 10,
      date: "2026-03-15",
    });
    // Cross currency ride — normalized_amount is null
    await handleLogRide(db, DEFAULT_CONFIG, {
      provider: "grab",
      amount: 50,
      currency: "MYR",
      date: "2026-03-16",
    });

    const stats = await handleSpendingStats(db, {
      start_date: "2026-03-01",
      end_date: "2026-03-31",
    });

    expect(stats.total_amount).toBe(10);
    expect(stats.total_rides).toBe(1);
  });
});
