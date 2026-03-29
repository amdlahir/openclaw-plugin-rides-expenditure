import type { Client } from "@libsql/client";
import { recomputeAllNormalizedAmounts, type FetchRatesFn, fetchRatesFromApi } from "../currency";

export type SetBudgetInput = {
  monthly_limit: number;
  alert_threshold?: number;
  currency?: string;
};

export type BudgetConfig = {
  defaultCurrency: string;
};

export async function handleSetBudget(
  db: Client,
  config: BudgetConfig,
  input: SetBudgetInput,
  fetchRates: FetchRatesFn = fetchRatesFromApi,
) {
  const limitCents = Math.round(input.monthly_limit * 100);
  const threshold = Math.max(0, Math.min(1, input.alert_threshold ?? 0.8));
  const currency = input.currency || config.defaultCurrency;

  // Check if currency changed from existing budget
  const existing = await db.execute({
    sql: "SELECT currency FROM budgets ORDER BY id DESC LIMIT 1",
    args: [],
  });
  const previousCurrency = existing.rows.length > 0 ? String(existing.rows[0].currency) : null;

  await db.execute("DELETE FROM budgets");
  await db.execute({
    sql: `INSERT INTO budgets (monthly_limit, currency, alert_threshold, updated_at)
          VALUES (?, ?, ?, ?)`,
    args: [limitCents, currency, threshold, Date.now()],
  });

  // If currency changed, recompute all normalized amounts
  if (previousCurrency && previousCurrency !== currency) {
    await recomputeAllNormalizedAmounts(db, currency, fetchRates);
  }

  return {
    success: true,
    monthly_limit: input.monthly_limit,
    alert_threshold: threshold,
    currency,
  };
}

export async function handleGetBudgetStatus(db: Client) {
  const budgetResult = await db.execute({
    sql: "SELECT monthly_limit, alert_threshold, currency FROM budgets ORDER BY id DESC LIMIT 1",
    args: [],
  });

  if (budgetResult.rows.length === 0) {
    // No budget set — still return current month spending
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime();

    const spendResult = await db.execute({
      sql: "SELECT COALESCE(SUM(normalized_amount), 0) as total, COUNT(*) as count FROM rides WHERE date >= ? AND date < ? AND normalized_amount IS NOT NULL",
      args: [monthStart, monthEnd],
    });

    return {
      has_budget: false,
      monthly_limit: null,
      total_spent: Number(spendResult.rows[0].total) / 100,
      remaining: null,
      percentage_used: null,
      threshold_exceeded: false,
      alert_threshold: null,
      ride_count: Number(spendResult.rows[0].count),
      currency: null,
    };
  }

  const budget = budgetResult.rows[0];
  const monthlyLimit = Number(budget.monthly_limit);
  const alertThreshold = Number(budget.alert_threshold);
  const currency = String(budget.currency);

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime();

  const spendResult = await db.execute({
    sql: "SELECT COALESCE(SUM(normalized_amount), 0) as total, COUNT(*) as count FROM rides WHERE date >= ? AND date < ? AND normalized_amount IS NOT NULL",
    args: [monthStart, monthEnd],
  });

  const totalSpent = Number(spendResult.rows[0].total);
  const rideCount = Number(spendResult.rows[0].count);
  const percentageUsed = monthlyLimit > 0 ? totalSpent / monthlyLimit : 0;

  return {
    has_budget: true,
    monthly_limit: monthlyLimit / 100,
    total_spent: totalSpent / 100,
    remaining: (monthlyLimit - totalSpent) / 100,
    percentage_used: Math.round(percentageUsed * 1000) / 1000,
    threshold_exceeded: percentageUsed >= alertThreshold,
    alert_threshold: alertThreshold,
    ride_count: rideCount,
    currency,
  };
}
