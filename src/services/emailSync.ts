import type { Client } from "@libsql/client";
import { syncEmails, type SyncConfig } from "../gmail/sync";

let syncInterval: ReturnType<typeof setInterval> | null = null;

export function createEmailSyncService(
  db: Client,
  config: SyncConfig,
  intervalMinutes: number,
) {
  return {
    id: "rides-email-sync",
    async start() {
      // Check if sync is enabled
      const state = await db.execute({
        sql: "SELECT email_sync_enabled FROM sync_state WHERE id = 1",
        args: [],
      });

      if (!state.rows[0]?.email_sync_enabled) {
        return;
      }

      // Run immediate sync
      await syncEmails(db, config);

      // Schedule recurring sync
      syncInterval = setInterval(
        () => syncEmails(db, config),
        intervalMinutes * 60 * 1000,
      );
    },
    stop() {
      if (syncInterval) {
        clearInterval(syncInterval);
        syncInterval = null;
      }
    },
  };
}
