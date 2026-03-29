import type { Client } from "@libsql/client";
import { syncEmails, type SyncConfig } from "../gmail/sync";

export async function handleSyncRideEmails(
  db: Client,
  config: SyncConfig,
  provider?: string,
) {
  return syncEmails(db, config, provider);
}
