import { describe, it, expect, beforeEach } from "vitest";
import { createInMemoryClient } from "../src/db/client";
import { runMigrations } from "../src/db/schema";
import { handleSetBudget, handleGetBudgetStatus } from "../src/tools/budget";
import { handleLogRide } from "../src/tools/rides";
import type { FetchRatesFn } from "../src/currency";
import type { Client } from "@libsql/client";

const DEFAULT_CONFIG = {
  defaultCurrency: "SGD",
  defaultCategory: "personal",
};

const mockFetch: FetchRatesFn = async (_base, targets) => {
  const rates: Record<string, number> = { SGD: 1.35, USD: 0.74, MYR: 3.4 };
  const result: Record<string, number> = {};
  for (const t of targets) {
    if (rates[t] != null) result[t] = rates[t];
  }
  return Object.keys(result).length > 0 ? result : null;
};

describe("budget management", () => {
  let db: Client;

  beforeEach(async () => {
    db = createInMemoryClient();
    await runMigrations(db);
  });

  it("sets a budget and retrieves status", async () => {
    // Log a ride in current month
    const now = new Date();
    await handleLogRide(db, DEFAULT_CONFIG, {
      provider: "grab",
      amount: 15,
      date: now.toISOString(),
    });

    const setResult = await handleSetBudget(db, DEFAULT_CONFIG, {
      monthly_limit: 500,
    });
    expect(setResult.success).toBe(true);
    expect(setResult.monthly_limit).toBe(500);
    expect(setResult.alert_threshold).toBe(0.8);
    expect(setResult.currency).toBe("SGD");

    const status = await handleGetBudgetStatus(db);
    expect(status.has_budget).toBe(true);
    expect(status.monthly_limit).toBe(500);
    expect(status.total_spent).toBe(15);
    expect(status.remaining).toBe(485);
    expect(status.ride_count).toBe(1);
    expect(status.currency).toBe("SGD");
  });

  it("returns has_budget false when no budget set", async () => {
    const status = await handleGetBudgetStatus(db);
    expect(status.has_budget).toBe(false);
    expect(status.monthly_limit).toBeNull();
  });

  it("replaces existing budget on set", async () => {
    await handleSetBudget(db, DEFAULT_CONFIG, { monthly_limit: 500 });
    await handleSetBudget(db, DEFAULT_CONFIG, { monthly_limit: 300 });

    const status = await handleGetBudgetStatus(db);
    expect(status.monthly_limit).toBe(300);
  });

  it("detects threshold exceeded", async () => {
    const now = new Date();
    await handleLogRide(db, DEFAULT_CONFIG, {
      provider: "grab",
      amount: 450,
      date: now.toISOString(),
    });

    await handleSetBudget(db, DEFAULT_CONFIG, {
      monthly_limit: 500,
      alert_threshold: 0.8,
    });

    const status = await handleGetBudgetStatus(db);
    expect(status.threshold_exceeded).toBe(true);
    expect(status.percentage_used).toBe(0.9);
  });

  it("sets budget with custom currency", async () => {
    const result = await handleSetBudget(db, DEFAULT_CONFIG, {
      monthly_limit: 1000,
      currency: "MYR",
    }, mockFetch);

    expect(result.currency).toBe("MYR");
  });

  it("recomputes normalized amounts when budget currency changes", async () => {
    // Set initial budget in SGD
    await handleSetBudget(db, DEFAULT_CONFIG, { monthly_limit: 500, currency: "SGD" }, mockFetch);

    // Log rides in SGD
    const now = new Date();
    await handleLogRide(db, DEFAULT_CONFIG, {
      provider: "grab",
      amount: 10,
      date: now.toISOString(),
    });

    // Change budget to MYR — should recompute
    await handleSetBudget(db, DEFAULT_CONFIG, { monthly_limit: 2000, currency: "MYR" }, mockFetch);

    const status = await handleGetBudgetStatus(db);
    expect(status.currency).toBe("MYR");
    // The ride's normalized_amount should now be in MYR
    // SGD 1000 cents * 3.4 = 3400 MYR cents = $34
    expect(status.total_spent).toBe(34);
  });

  it("clamps alert_threshold to [0, 1]", async () => {
    const result = await handleSetBudget(db, DEFAULT_CONFIG, {
      monthly_limit: 500,
      alert_threshold: 1.5,
    });
    expect(result.alert_threshold).toBe(1);
  });
});
