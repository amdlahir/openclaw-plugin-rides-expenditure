import type { Client } from "@libsql/client";

export async function checkUnnotifiedSyncErrors(db: Client): Promise<string | null> {
  const result = await db.execute({
    sql: "SELECT id, errors, timestamp FROM sync_logs WHERE errors IS NOT NULL AND notified_at IS NULL ORDER BY timestamp DESC",
    args: [],
  });

  if (result.rows.length === 0) return null;

  let totalErrors = 0;
  const logIds: number[] = [];

  for (const row of result.rows) {
    try {
      const errors = JSON.parse(String(row.errors)) as string[];
      totalErrors += errors.length;
    } catch {
      totalErrors += 1;
    }
    logIds.push(Number(row.id));
  }

  // Mark as notified
  for (const id of logIds) {
    await db.execute({
      sql: "UPDATE sync_logs SET notified_at = ? WHERE id = ?",
      args: [Date.now(), id],
    });
  }

  return `Email sync encountered ${totalErrors} parse error(s) across ${result.rows.length} sync run(s) since your last session. Check /rides-sync for details.`;
}
