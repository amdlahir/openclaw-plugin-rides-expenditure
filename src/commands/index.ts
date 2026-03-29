import type { Client } from "@libsql/client";

export function createRidesCommand(db: Client) {
  return {
    name: "rides",
    description: "Show recent rides in a formatted table",
    requireAuth: false,
    handler: async () => {
      const result = await db.execute({
        sql: `SELECT id, provider, original_amount, original_currency, date, pickup, dropoff
              FROM rides ORDER BY date DESC LIMIT 10`,
        args: [],
      });

      if (result.rows.length === 0) {
        return { text: "No rides logged yet." };
      }

      const lines = ["Recent Rides (last 10):", ""];
      const header = "| ID | Provider | Amount | Date | Route |";
      const sep = "|---:|----------|-------:|------|-------|";
      lines.push(header, sep);

      for (const row of result.rows) {
        const amount = (Number(row.original_amount) / 100).toFixed(2);
        const currency = row.original_currency;
        const date = new Date(Number(row.date)).toISOString().split("T")[0];
        const pickup = row.pickup || "—";
        const dropoff = row.dropoff || "—";
        const route = `${pickup} → ${dropoff}`;
        lines.push(
          `| ${row.id} | ${String(row.provider).charAt(0).toUpperCase() + String(row.provider).slice(1)} | ${currency} ${amount} | ${date} | ${route} |`,
        );
      }

      return { text: lines.join("\n") };
    },
  };
}

export function createRidesStatsCommand(db: Client) {
  return {
    name: "rides_stats",
    description: "Show current month spending summary",
    requireAuth: false,
    handler: async () => {
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
      const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime();
      const monthName = now.toLocaleString("en-US", { month: "long", year: "numeric" });

      // Total
      const totalResult = await db.execute({
        sql: "SELECT COALESCE(SUM(normalized_amount), 0) as total, COUNT(*) as count FROM rides WHERE date >= ? AND date < ? AND normalized_amount IS NOT NULL",
        args: [monthStart, monthEnd],
      });
      const totalCents = Number(totalResult.rows[0].total);
      const totalRides = Number(totalResult.rows[0].count);

      // By provider
      const providerResult = await db.execute({
        sql: "SELECT provider, SUM(normalized_amount) as total, COUNT(*) as count FROM rides WHERE date >= ? AND date < ? AND normalized_amount IS NOT NULL GROUP BY provider ORDER BY total DESC",
        args: [monthStart, monthEnd],
      });

      // By category
      const categoryResult = await db.execute({
        sql: "SELECT category, SUM(normalized_amount) as total, COUNT(*) as count FROM rides WHERE date >= ? AND date < ? AND normalized_amount IS NOT NULL GROUP BY category ORDER BY total DESC",
        args: [monthStart, monthEnd],
      });

      // Budget
      const budgetResult = await db.execute({
        sql: "SELECT monthly_limit, alert_threshold, currency FROM budgets ORDER BY id DESC LIMIT 1",
        args: [],
      });

      const lines = [`${monthName} Spending Summary`, ""];
      lines.push(`Total: $${(totalCents / 100).toFixed(2)} (${totalRides} rides)`, "");

      if (providerResult.rows.length > 0) {
        lines.push("By Provider:");
        for (const row of providerResult.rows) {
          const name = String(row.provider).charAt(0).toUpperCase() + String(row.provider).slice(1);
          lines.push(`  ${name}: $${(Number(row.total) / 100).toFixed(2)} (${row.count} rides)`);
        }
        lines.push("");
      }

      if (categoryResult.rows.length > 0) {
        lines.push("By Category:");
        for (const row of categoryResult.rows) {
          const name = String(row.category).charAt(0).toUpperCase() + String(row.category).slice(1);
          lines.push(`  ${name}: $${(Number(row.total) / 100).toFixed(2)} (${row.count} rides)`);
        }
        lines.push("");
      }

      if (budgetResult.rows.length > 0) {
        const limit = Number(budgetResult.rows[0].monthly_limit);
        const pct = limit > 0 ? ((totalCents / limit) * 100).toFixed(1) : "0.0";
        const threshold = Number(budgetResult.rows[0].alert_threshold);
        const exceeded = totalCents / limit >= threshold;
        const indicator = exceeded ? "⚠" : "✓";
        lines.push(
          `Budget: $${(totalCents / 100).toFixed(2)} / $${(limit / 100).toFixed(2)} (${pct}%) ${indicator}`,
        );
      }

      return { text: lines.join("\n") };
    },
  };
}

export function createRidesSyncCommand(db: Client, syncFn: (months?: number) => Promise<{ success: boolean; emails_processed: number; rides_created: number; errors: string[] }>) {
  return {
    name: "rides_sync",
    description: "Trigger email sync and report results. Pass a number to sync that many months of history (e.g., /rides_sync 6).",
    requireAuth: false,
    acceptsArgs: true,
    handler: async (ctx: { args?: string }) => {
      const months = ctx.args ? parseInt(ctx.args.trim(), 10) : undefined;
      const result = await syncFn(Number.isNaN(months) ? undefined : months);

      const stateResult = await db.execute({
        sql: "SELECT last_sync_at FROM sync_state WHERE id = 1",
        args: [],
      });
      const lastSync = stateResult.rows[0]?.last_sync_at
        ? new Date(Number(stateResult.rows[0].last_sync_at)).toISOString().replace("T", " ").split(".")[0]
        : "Never";

      const lines = [
        "Email Sync Results",
        "",
        `Emails processed: ${result.emails_processed}`,
        `Rides created: ${result.rides_created}`,
        `Errors: ${result.errors.length > 0 ? result.errors.join("; ") : "none"}`,
        "",
        `Last sync: ${lastSync}`,
      ];

      return { text: lines.join("\n") };
    },
  };
}
