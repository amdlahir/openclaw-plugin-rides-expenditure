import type { Client } from "@libsql/client";

export type PluginConfig = {
  defaultCurrency: string;
  defaultCategory: string;
};

export type LogRideInput = {
  provider: string;
  amount: number;
  currency?: string;
  date?: string;
  pickup?: string;
  dropoff?: string;
  category?: string;
};

export type ListRidesInput = {
  limit?: number;
  provider?: string;
  category?: string;
  start_date?: string;
  end_date?: string;
};

export async function handleLogRide(
  db: Client,
  config: PluginConfig,
  input: LogRideInput,
) {
  const amountCents = Math.round(input.amount * 100);
  const currency = input.currency || config.defaultCurrency;
  const category = input.category || config.defaultCategory;
  const dateMs = input.date ? new Date(input.date).getTime() : Date.now();

  const isSameCurrency = currency === config.defaultCurrency;

  const result = await db.execute({
    sql: `INSERT INTO rides (provider, original_amount, original_currency, normalized_amount, normalized_currency, date, pickup, dropoff, category, source, confidence)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual', 1.0)`,
    args: [
      input.provider,
      amountCents,
      currency,
      isSameCurrency ? amountCents : null,
      isSameCurrency ? currency : null,
      dateMs,
      input.pickup || null,
      input.dropoff || null,
      category,
    ],
  });

  const id = Number(result.lastInsertRowid);
  return {
    id,
    message: `Logged ${input.provider} ride: $${input.amount.toFixed(2)} ${currency} on ${new Date(dateMs).toISOString().split("T")[0]}`,
  };
}

export async function handleListRides(db: Client, input: ListRidesInput) {
  const limit = Math.min(Math.max(input.limit || 10, 1), 50);
  const conditions: string[] = [];
  const args: unknown[] = [];

  if (input.provider) {
    conditions.push("provider = ?");
    args.push(input.provider);
  }
  if (input.category) {
    conditions.push("category = ?");
    args.push(input.category);
  }
  if (input.start_date) {
    conditions.push("date >= ?");
    args.push(new Date(input.start_date).getTime());
  }
  if (input.end_date) {
    conditions.push("date <= ?");
    args.push(new Date(input.end_date).getTime());
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const [ridesResult, countResult] = await Promise.all([
    db.execute({
      sql: `SELECT id, provider, original_amount, original_currency, normalized_amount, normalized_currency, date, pickup, dropoff, category, source, confidence
            FROM rides ${where} ORDER BY date DESC LIMIT ?`,
      args: [...args, limit],
    }),
    db.execute({
      sql: `SELECT COUNT(*) as total FROM rides ${where}`,
      args,
    }),
  ]);

  const rides = ridesResult.rows.map((row) => ({
    id: row.id,
    provider: row.provider,
    amount: Number(row.original_amount) / 100,
    currency: row.original_currency,
    normalized_amount:
      row.normalized_amount != null
        ? Number(row.normalized_amount) / 100
        : null,
    normalized_currency: row.normalized_currency,
    date: new Date(Number(row.date)).toISOString(),
    pickup: row.pickup,
    dropoff: row.dropoff,
    category: row.category,
    source: row.source,
    confidence: row.confidence,
  }));

  return {
    rides,
    total: Number(countResult.rows[0].total),
  };
}

export type SearchRidesInput = {
  query: string;
  limit?: number;
};

export async function handleSearchRides(db: Client, input: SearchRidesInput) {
  const limit = Math.min(Math.max(input.limit || 10, 1), 50);
  const pattern = `%${input.query}%`;

  const result = await db.execute({
    sql: `SELECT id, provider, original_amount, original_currency, normalized_amount, normalized_currency, date, pickup, dropoff, category, source, confidence
          FROM rides
          WHERE pickup LIKE ? OR dropoff LIKE ?
          ORDER BY date DESC LIMIT ?`,
    args: [pattern, pattern, limit],
  });

  const rides = result.rows.map((row) => ({
    id: row.id,
    provider: row.provider,
    amount: Number(row.original_amount) / 100,
    currency: row.original_currency,
    normalized_amount:
      row.normalized_amount != null ? Number(row.normalized_amount) / 100 : null,
    normalized_currency: row.normalized_currency,
    date: new Date(Number(row.date)).toISOString(),
    pickup: row.pickup,
    dropoff: row.dropoff,
    category: row.category,
    source: row.source,
    confidence: row.confidence,
  }));

  return { rides };
}

export type UpdateRideInput = {
  ride_id: number;
  amount?: number;
  category?: string;
  pickup?: string;
  dropoff?: string;
};

export async function handleUpdateRide(db: Client, input: UpdateRideInput) {
  const existing = await db.execute({
    sql: "SELECT id FROM rides WHERE id = ?",
    args: [input.ride_id],
  });

  if (existing.rows.length === 0) {
    return { success: false, message: `Ride ${input.ride_id} not found` };
  }

  const sets: string[] = [];
  const args: unknown[] = [];

  if (input.amount !== undefined) {
    sets.push("original_amount = ?");
    args.push(Math.round(input.amount * 100));
  }
  if (input.category !== undefined) {
    sets.push("category = ?");
    args.push(input.category);
  }
  if (input.pickup !== undefined) {
    sets.push("pickup = ?");
    args.push(input.pickup);
  }
  if (input.dropoff !== undefined) {
    sets.push("dropoff = ?");
    args.push(input.dropoff);
  }

  sets.push("manually_edited = 1");
  args.push(input.ride_id);

  await db.execute({
    sql: `UPDATE rides SET ${sets.join(", ")} WHERE id = ?`,
    args,
  });

  return { success: true, message: `Ride ${input.ride_id} updated` };
}

export async function handleDeleteRide(db: Client, rideId: number) {
  const result = await db.execute({
    sql: "DELETE FROM rides WHERE id = ?",
    args: [rideId],
  });

  if (result.rowsAffected > 0) {
    return { success: true, message: "Ride deleted" };
  }
  return { success: false, message: "Ride not found" };
}
