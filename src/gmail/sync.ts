import type { Client } from "@libsql/client";
import {
  PROVIDER_EMAILS,
  refreshGmailToken,
  fetchGmailMessages,
  fetchMessageDetail,
  extractEmailBody,
} from "./api";
import { parseGrabReceipt, parseGojekReceipt, parseZigReceipt } from "../parsers/emailParser";
import { normalizeRideAmount, type FetchRatesFn, fetchRatesFromApi } from "../currency";

export type SyncConfig = {
  googleClientId: string;
  googleClientSecret: string;
  defaultCategory: string;
  defaultCurrency: string;
};

export type SyncResult = {
  success: boolean;
  emails_processed: number;
  rides_created: number;
  errors: string[];
};

const PARSERS: Record<string, typeof parseGrabReceipt> = {
  grab: parseGrabReceipt,
  gojek: parseGojekReceipt,
  zig: parseZigReceipt,
};

const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000; // 5 minutes

export async function syncEmails(
  db: Client,
  config: SyncConfig,
  provider?: string,
  months?: number,
  fetchRates: FetchRatesFn = fetchRatesFromApi,
): Promise<SyncResult> {
  const errors: string[] = [];
  let totalProcessed = 0;
  let totalCreated = 0;

  // Read sync state
  const stateResult = await db.execute({
    sql: "SELECT gmail_access_token, gmail_refresh_token, gmail_token_expires_at, email_sync_enabled, last_sync_at FROM sync_state WHERE id = 1",
    args: [],
  });

  const state = stateResult.rows[0];
  if (!state || !state.email_sync_enabled) {
    return { success: false, emails_processed: 0, rides_created: 0, errors: ["Email sync not enabled"] };
  }

  let accessToken = state.gmail_access_token as string;
  const refreshToken = state.gmail_refresh_token as string;
  const tokenExpiresAt = Number(state.gmail_token_expires_at);
  const lastSyncAt = state.last_sync_at ? Number(state.last_sync_at) : undefined;

  if (!accessToken || !refreshToken) {
    return { success: false, emails_processed: 0, rides_created: 0, errors: ["Gmail not connected"] };
  }

  // Refresh token if needed
  if (Date.now() > tokenExpiresAt - TOKEN_REFRESH_BUFFER_MS) {
    try {
      const refreshed = await refreshGmailToken(
        refreshToken,
        config.googleClientId,
        config.googleClientSecret,
      );
      accessToken = refreshed.accessToken;
      await db.execute({
        sql: "UPDATE sync_state SET gmail_access_token = ?, gmail_token_expires_at = ? WHERE id = 1",
        args: [refreshed.accessToken, refreshed.expiresAt],
      });
    } catch (err) {
      return {
        success: false,
        emails_processed: 0,
        rides_created: 0,
        errors: [`Token refresh failed: ${err instanceof Error ? err.message : "Unknown error"}`],
      };
    }
  }

  // Determine the after date: explicit months param > last_sync_at > no filter
  let afterDate: number | undefined;
  if (months) {
    const d = new Date();
    d.setMonth(d.getMonth() - months);
    afterDate = d.getTime();
  } else {
    afterDate = lastSyncAt;
  }

  // Determine which providers to sync
  const providersToSync = provider ? [provider] : Object.keys(PROVIDER_EMAILS);

  for (const prov of providersToSync) {
    const providerEmail = PROVIDER_EMAILS[prov];
    if (!providerEmail) continue;

    try {
      const messages = await fetchGmailMessages(accessToken, providerEmail, afterDate, prov);

      for (const msg of messages) {
        try {
          const detail = await fetchMessageDetail(accessToken, msg.id);
          const emailBody = extractEmailBody(detail);

          if (!emailBody) {
            errors.push(`Empty body for message ${msg.id}`);
            totalProcessed++;
            continue;
          }

          const parser = PARSERS[prov];
          if (!parser) continue;

          const result = parser(emailBody, detail.internalDate);
          totalProcessed++;

          if (result.status === "skipped") continue;
          if (result.status === "failed") {
            errors.push(`Failed to parse ${prov} receipt from message ${msg.id}`);
            continue;
          }

          const parsed = result.data;

          // Normalize amount
          const { normalizedAmount, normalizedCurrency } = await normalizeRideAmount(
            db,
            parsed.amount,
            parsed.currency,
            config.defaultCurrency,
            fetchRates,
          );

          const insertResult = await db.execute({
            sql: `INSERT OR IGNORE INTO rides (provider, original_amount, original_currency, normalized_amount, normalized_currency, date, pickup, dropoff, category, source, raw_email_id, confidence)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'email', ?, ?)`,
            args: [
              prov,
              parsed.amount,
              parsed.currency,
              normalizedAmount,
              normalizedCurrency,
              parsed.date,
              parsed.pickup,
              parsed.dropoff,
              config.defaultCategory,
              msg.id,
              parsed.confidence,
            ],
          });

          if (insertResult.rowsAffected > 0) {
            totalCreated++;
          }
        } catch (err) {
          errors.push(`Error processing message ${msg.id}: ${err instanceof Error ? err.message : "Unknown"}`);
        }
      }
    } catch (err) {
      errors.push(`Error fetching ${prov} messages: ${err instanceof Error ? err.message : "Unknown"}`);
    }
  }

  // Update last sync timestamp
  await db.execute({
    sql: "UPDATE sync_state SET last_sync_at = ? WHERE id = 1",
    args: [Date.now()],
  });

  // Create sync log
  await db.execute({
    sql: "INSERT INTO sync_logs (timestamp, emails_processed, rides_created, errors) VALUES (?, ?, ?, ?)",
    args: [
      Date.now(),
      totalProcessed,
      totalCreated,
      errors.length > 0 ? JSON.stringify(errors) : null,
    ],
  });

  return {
    success: true,
    emails_processed: totalProcessed,
    rides_created: totalCreated,
    errors,
  };
}
