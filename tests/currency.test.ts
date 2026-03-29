import { describe, it, expect, beforeEach } from "vitest";
import { createInMemoryClient } from "../src/db/client";
import { runMigrations } from "../src/db/schema";
import {
  getExchangeRate,
  convertAmount,
  normalizeRideAmount,
  backfillNormalizedAmounts,
  recomputeAllNormalizedAmounts,
  cacheRate,
  type FetchRatesFn,
} from "../src/currency";
import { handleLogRide, handleListRides } from "../src/tools/rides";
import type { Client } from "@libsql/client";

const DEFAULT_CONFIG = {
  defaultCurrency: "SGD",
  defaultCategory: "personal",
};

// Mock fetch that returns known rates
const mockFetch: FetchRatesFn = async (_base, targets) => {
  const rates: Record<string, number> = {
    SGD: 1.35,
    USD: 0.74,
    MYR: 3.4,
  };
  const result: Record<string, number> = {};
  for (const t of targets) {
    if (rates[t] != null) result[t] = rates[t];
  }
  return Object.keys(result).length > 0 ? result : null;
};

// Mock fetch that fails
const failingFetch: FetchRatesFn = async () => null;

describe("currency conversion", () => {
  let db: Client;

  beforeEach(async () => {
    db = createInMemoryClient();
    await runMigrations(db);
  });

  it("converts amount using rate", () => {
    // 1000 cents * 1.35 = 1350 cents
    expect(convertAmount(1000, 1.35)).toBe(1350);
  });

  it("rounds converted amount to nearest cent", () => {
    // 999 cents * 1.35 = 1348.65 → 1349
    expect(convertAmount(999, 1.35)).toBe(1349);
  });

  it("returns rate 1 for same currency", async () => {
    const rate = await getExchangeRate(db, "SGD", "SGD", mockFetch);
    expect(rate).toBe(1);
  });

  it("fetches and caches rate on first call", async () => {
    const rate = await getExchangeRate(db, "USD", "SGD", mockFetch);
    expect(rate).toBe(1.35);

    // Second call uses cache (even with failing fetch)
    const cached = await getExchangeRate(db, "USD", "SGD", failingFetch);
    expect(cached).toBe(1.35);
  });

  it("uses stale cache when API is unavailable", async () => {
    // Pre-populate with old rate
    await cacheRate(db, "USD", "SGD", 1.30);
    // Backdate the fetched_at to make it stale
    await db.execute({
      sql: "UPDATE exchange_rates SET fetched_at = ? WHERE from_currency = 'USD' AND to_currency = 'SGD'",
      args: [Date.now() - 48 * 60 * 60 * 1000], // 48 hours ago
    });

    const rate = await getExchangeRate(db, "USD", "SGD", failingFetch);
    expect(rate).toBe(1.30); // stale but usable
  });

  it("returns null when no cache and API fails", async () => {
    const rate = await getExchangeRate(db, "USD", "SGD", failingFetch);
    expect(rate).toBeNull();
  });

  it("normalizes same-currency without API call", async () => {
    const result = await normalizeRideAmount(db, 1500, "SGD", "SGD", failingFetch);
    expect(result.normalizedAmount).toBe(1500);
    expect(result.normalizedCurrency).toBe("SGD");
  });

  it("normalizes cross-currency with exchange rate", async () => {
    const result = await normalizeRideAmount(db, 1000, "USD", "SGD", mockFetch);
    expect(result.normalizedAmount).toBe(1350);
    expect(result.normalizedCurrency).toBe("SGD");
  });

  it("returns null normalized when no rate available", async () => {
    const result = await normalizeRideAmount(db, 1000, "USD", "SGD", failingFetch);
    expect(result.normalizedAmount).toBeNull();
    expect(result.normalizedCurrency).toBeNull();
  });

  it("backfills null normalized amounts", async () => {
    // Create a ride with null normalized_amount (cross-currency, no rate)
    await handleLogRide(db, DEFAULT_CONFIG, {
      provider: "grab",
      amount: 50,
      currency: "MYR",
      date: "2026-03-15",
    });

    // Verify it's null
    let list = await handleListRides(db, {});
    expect(list.rides[0].normalized_amount).toBeNull();

    // Backfill with mock rates
    const count = await backfillNormalizedAmounts(db, "SGD", mockFetch);
    expect(count).toBe(1);

    // Verify it's now filled
    list = await handleListRides(db, {});
    expect(list.rides[0].normalized_amount).not.toBeNull();
    expect(list.rides[0].normalized_currency).toBe("SGD");
  });

  it("recomputes all normalized amounts on currency change", async () => {
    // Two SGD rides
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

    // Currently normalized as SGD
    let list = await handleListRides(db, {});
    expect(list.rides[0].normalized_currency).toBe("SGD");

    // Recompute to MYR
    const count = await recomputeAllNormalizedAmounts(db, "MYR", mockFetch);
    expect(count).toBe(2);

    list = await handleListRides(db, {});
    expect(list.rides[0].normalized_currency).toBe("MYR");
    expect(list.rides[1].normalized_currency).toBe("MYR");
    // SGD 2000 cents * 3.4 = 6800 MYR cents
    expect(list.rides[0].normalized_amount).toBe(68);
  });
});
