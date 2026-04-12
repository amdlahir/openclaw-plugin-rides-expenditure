import type { Client } from "@libsql/client";
import { syncEmails, type SyncConfig } from "../gmail/sync";

export async function handleSyncRideEmails(
  db: Client,
  config: SyncConfig,
  provider?: string,
  months?: number,
  tokensPath?: string,
) {
  if (!config.googleClientId || !config.googleClientSecret) {
    return {
      success: false,
      emails_processed: 0,
      rides_created: 0,
      errors: ["Gmail not configured. Set googleClientId and googleClientSecret in the plugin config."],
    };
  }

  return syncEmails(db, config, provider, months, undefined, tokensPath);
}
