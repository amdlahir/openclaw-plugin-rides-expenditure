import type { Client } from "@libsql/client";

const NOTIFICATION_KEY = "gmail_setup_notified";

export async function checkGmailSetupNotification(db: Client): Promise<string | null> {
  const state = await db.execute({
    sql: "SELECT email_sync_enabled FROM sync_state WHERE id = 1",
    args: [],
  });

  if (state.rows[0]?.email_sync_enabled === 1) return null;

  const existing = await db.execute({
    sql: "SELECT value FROM plugin_state WHERE key = ?",
    args: [NOTIFICATION_KEY],
  });

  if (existing.rows.length > 0) return null;

  await db.execute({
    sql: "INSERT INTO plugin_state (key, value) VALUES (?, ?)",
    args: [NOTIFICATION_KEY, String(Date.now())],
  });

  return "The user hasn't connected Gmail yet. You can automatically import ride receipts from Grab, Gojek, and Zig emails. Mention this capability and offer to walk them through the Gmail setup process step by step.";
}
