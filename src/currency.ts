import type { Client } from "@libsql/client";

const FRANKFURTER_API = "https://api.frankfurter.dev/latest";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export type FetchRatesFn = (
  baseCurrency: string,
  targetCurrencies: string[],
) => Promise<Record<string, number> | null>;

export const fetchRatesFromApi: FetchRatesFn = async (
  baseCurrency,
  targetCurrencies,
) => {
  try {
    const symbols = targetCurrencies.join(",");
    const res = await fetch(
      `${FRANKFURTER_API}?from=${baseCurrency}&to=${symbols}`,
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { rates: Record<string, number> };
    return data.rates;
  } catch {
    return null;
  }
};

export async function getCachedRate(
  db: Client,
  from: string,
  to: string,
): Promise<{ rate: number; stale: boolean } | null> {
  const result = await db.execute({
    sql: "SELECT rate, fetched_at FROM exchange_rates WHERE from_currency = ? AND to_currency = ?",
    args: [from, to],
  });

  if (result.rows.length === 0) return null;

  const rate = Number(result.rows[0].rate);
  const fetchedAt = Number(result.rows[0].fetched_at);
  const stale = Date.now() - fetchedAt > CACHE_TTL_MS;

  return { rate, stale };
}

export async function cacheRate(
  db: Client,
  from: string,
  to: string,
  rate: number,
): Promise<void> {
  await db.execute({
    sql: `INSERT INTO exchange_rates (from_currency, to_currency, rate, fetched_at)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(from_currency, to_currency) DO UPDATE SET rate = excluded.rate, fetched_at = excluded.fetched_at`,
    args: [from, to, rate, Date.now()],
  });
}

export async function getExchangeRate(
  db: Client,
  from: string,
  to: string,
  fetchRates: FetchRatesFn = fetchRatesFromApi,
): Promise<number | null> {
  if (from === to) return 1;

  const cached = await getCachedRate(db, from, to);

  if (cached && !cached.stale) {
    return cached.rate;
  }

  // Try to fetch fresh rates
  const rates = await fetchRates(from, [to]);
  if (rates && rates[to] != null) {
    await cacheRate(db, from, to, rates[to]);
    return rates[to];
  }

  // Fallback to stale cache
  if (cached) {
    return cached.rate;
  }

  return null;
}

export function convertAmount(
  amountCents: number,
  rate: number,
): number {
  return Math.round(amountCents * rate);
}

export async function normalizeRideAmount(
  db: Client,
  originalAmountCents: number,
  originalCurrency: string,
  targetCurrency: string,
  fetchRates: FetchRatesFn = fetchRatesFromApi,
): Promise<{ normalizedAmount: number | null; normalizedCurrency: string | null }> {
  if (originalCurrency === targetCurrency) {
    return {
      normalizedAmount: originalAmountCents,
      normalizedCurrency: targetCurrency,
    };
  }

  const rate = await getExchangeRate(db, originalCurrency, targetCurrency, fetchRates);
  if (rate == null) {
    return { normalizedAmount: null, normalizedCurrency: null };
  }

  return {
    normalizedAmount: convertAmount(originalAmountCents, rate),
    normalizedCurrency: targetCurrency,
  };
}

export async function backfillNormalizedAmounts(
  db: Client,
  targetCurrency: string,
  fetchRates: FetchRatesFn = fetchRatesFromApi,
): Promise<number> {
  const nullRows = await db.execute({
    sql: "SELECT id, original_amount, original_currency FROM rides WHERE normalized_amount IS NULL",
    args: [],
  });

  let updated = 0;
  for (const row of nullRows.rows) {
    const { normalizedAmount, normalizedCurrency } = await normalizeRideAmount(
      db,
      Number(row.original_amount),
      String(row.original_currency),
      targetCurrency,
      fetchRates,
    );

    if (normalizedAmount != null) {
      await db.execute({
        sql: "UPDATE rides SET normalized_amount = ?, normalized_currency = ? WHERE id = ?",
        args: [normalizedAmount, normalizedCurrency, row.id],
      });
      updated++;
    }
  }

  return updated;
}

export async function recomputeAllNormalizedAmounts(
  db: Client,
  targetCurrency: string,
  fetchRates: FetchRatesFn = fetchRatesFromApi,
): Promise<number> {
  const allRows = await db.execute({
    sql: "SELECT id, original_amount, original_currency FROM rides",
    args: [],
  });

  let updated = 0;
  for (const row of allRows.rows) {
    const { normalizedAmount, normalizedCurrency } = await normalizeRideAmount(
      db,
      Number(row.original_amount),
      String(row.original_currency),
      targetCurrency,
      fetchRates,
    );

    await db.execute({
      sql: "UPDATE rides SET normalized_amount = ?, normalized_currency = ? WHERE id = ?",
      args: [normalizedAmount, normalizedCurrency, row.id],
    });
    updated++;
  }

  return updated;
}
