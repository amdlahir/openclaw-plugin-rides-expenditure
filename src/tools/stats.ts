import type { Client } from "@libsql/client";

export type SpendingStatsInput = {
  start_date: string;
  end_date: string;
  group_by?: "provider" | "category" | "month";
};

export async function handleSpendingStats(
  db: Client,
  input: SpendingStatsInput,
) {
  const startMs = new Date(input.start_date).getTime();
  const endMs = new Date(input.end_date).getTime();
  const groupBy = input.group_by || "provider";

  let groupCol: string;
  if (groupBy === "month") {
    groupCol = "strftime('%Y-%m', date / 1000, 'unixepoch')";
  } else {
    groupCol = groupBy;
  }

  const [breakdownResult, totalResult] = await Promise.all([
    db.execute({
      sql: `SELECT ${groupCol} as grp, SUM(normalized_amount) as total, COUNT(*) as count
            FROM rides
            WHERE date >= ? AND date <= ? AND normalized_amount IS NOT NULL
            GROUP BY grp
            ORDER BY total DESC`,
      args: [startMs, endMs],
    }),
    db.execute({
      sql: `SELECT SUM(normalized_amount) as total, COUNT(*) as count
            FROM rides
            WHERE date >= ? AND date <= ? AND normalized_amount IS NOT NULL`,
      args: [startMs, endMs],
    }),
  ]);

  const breakdown = breakdownResult.rows.map((row) => ({
    group: String(row.grp),
    amount: Number(row.total) / 100,
    count: Number(row.count),
  }));

  return {
    total_amount: Number(totalResult.rows[0].total || 0) / 100,
    total_rides: Number(totalResult.rows[0].count),
    breakdown,
    currency: "SGD",
  };
}
