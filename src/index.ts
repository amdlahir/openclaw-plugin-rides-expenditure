import * as path from "path";
import { createDbClient } from "./db/client";
import { runMigrations } from "./db/schema";
import { getTokensPath, readTokens, writeTokens } from "./tokens";
import {
  handleLogRide,
  handleListRides,
  handleSearchRides,
  handleUpdateRide,
  handleDeleteRide,
} from "./tools/rides";
import { handleSpendingStats } from "./tools/stats";
import { handleSetBudget, handleGetBudgetStatus } from "./tools/budget";
import { createAuthHandler, createCallbackHandler } from "./routes/oauth";
import { handleSyncRideEmails } from "./tools/sync";
import { syncEmails } from "./gmail/sync";
import { createEmailSyncService } from "./services/emailSync";
import { checkUnnotifiedSyncErrors } from "./hooks/syncNotifications";
import { checkGmailSetupNotification } from "./hooks/gmailSetupNotification";
import { handleParseReceiptScreenshot } from "./tools/screenshot";
import {
  createRidesCommand,
  createRidesStatsCommand,
  createRidesSyncCommand,
  createRidesResetCommand,
  createRidesDisconnectCommand,
} from "./commands/index";
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { Type } from "@sinclair/typebox";
import type { Client } from "@libsql/client";

function getConfig(pluginConfig?: Record<string, unknown>) {
  return {
    defaultCurrency: (pluginConfig?.defaultCurrency as string) || "SGD",
    defaultCategory: (pluginConfig?.defaultCategory as string) || "personal",
    googleClientId: pluginConfig?.googleClientId as string,
    googleClientSecret: pluginConfig?.googleClientSecret as string,
    googleAiApiKey: pluginConfig?.googleAiApiKey as string | undefined,
    baseUrl: pluginConfig?.baseUrl as string,
    syncIntervalMinutes: (pluginConfig?.syncIntervalMinutes as number) || 15,
  };
}

function registerRideTools(api: Parameters<Parameters<typeof definePluginEntry>[0]["register"]>[0], db: Client, config: ReturnType<typeof getConfig>) {
  api.registerTool({
    name: "log_ride",
    label: "Log Ride",
    description:
      "Log a ride-hailing trip from Grab, Gojek, or Zig. Use this when the user tells you about a ride they took.",
    parameters: Type.Object({
      provider: Type.Unsafe<string>({
        type: "string",
        enum: ["grab", "gojek", "zig"],
        description: "Ride-hailing provider",
      }),
      amount: Type.Number({ description: "Fare amount (e.g., 15.50, not cents)" }),
      currency: Type.Unsafe<string | undefined>({
        type: "string",
        enum: ["SGD", "USD", "MYR"],
        description: `Currency code. Defaults to ${config.defaultCurrency}.`,
      }),
      date: Type.Optional(Type.String({ description: "Trip date in ISO 8601 format. Defaults to now." })),
      pickup: Type.Optional(Type.String({ description: "Pickup location" })),
      dropoff: Type.Optional(Type.String({ description: "Dropoff location" })),
      category: Type.Unsafe<"work" | "personal" | undefined>({
        type: "string",
        enum: ["work", "personal"],
        description: `Trip category. Defaults to ${config.defaultCategory}.`,
      }),
    }),
    async execute(_id, params) {
      const result = await handleLogRide(db, config, {
        provider: params.provider as string,
        amount: params.amount as number,
        currency: params.currency as string | undefined,
        date: params.date as string | undefined,
        pickup: params.pickup as string | undefined,
        dropoff: params.dropoff as string | undefined,
        category: params.category as string | undefined,
      });
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    },
  });

  api.registerTool({
    name: "list_rides",
    label: "List Rides",
    description:
      "List recent ride-hailing trips. Supports filtering by provider, category, and date range.",
    parameters: Type.Object({
      limit: Type.Optional(Type.Number({ description: "Max rides to return (default 10, max 50)" })),
      provider: Type.Unsafe<string | undefined>({
        type: "string",
        enum: ["grab", "gojek", "zig"],
        description: "Filter by provider",
      }),
      category: Type.Unsafe<"work" | "personal" | undefined>({
        type: "string",
        enum: ["work", "personal"],
        description: "Filter by category",
      }),
      start_date: Type.Optional(Type.String({ description: "Start date filter (ISO 8601)" })),
      end_date: Type.Optional(Type.String({ description: "End date filter (ISO 8601)" })),
    }),
    async execute(_id, params) {
      const result = await handleListRides(db, {
        limit: params.limit as number | undefined,
        provider: params.provider as string | undefined,
        category: params.category as string | undefined,
        start_date: params.start_date as string | undefined,
        end_date: params.end_date as string | undefined,
      });
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    },
  });

  api.registerTool({
    name: "search_rides",
    label: "Search Rides",
    description:
      "Search rides by pickup or dropoff location. Use when the user asks about rides to/from a specific place.",
    parameters: Type.Object({
      query: Type.String({ description: "Location search term (e.g., 'Orchard', 'MBS', 'Airport')" }),
      limit: Type.Optional(Type.Number({ description: "Max results (default 10)" })),
    }),
    async execute(_id, params) {
      const result = await handleSearchRides(db, {
        query: params.query as string,
        limit: params.limit as number | undefined,
      });
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    },
  });

  api.registerTool({
    name: "update_ride",
    label: "Update Ride",
    description: "Update details of an existing ride (amount, category, locations).",
    parameters: Type.Object({
      ride_id: Type.Number({ description: "ID of the ride to update" }),
      amount: Type.Optional(Type.Number({ description: "New fare amount" })),
      category: Type.Unsafe<"work" | "personal" | undefined>({
        type: "string",
        enum: ["work", "personal"],
      }),
      pickup: Type.Optional(Type.String({ description: "New pickup location" })),
      dropoff: Type.Optional(Type.String({ description: "New dropoff location" })),
    }),
    async execute(_id, params) {
      const result = await handleUpdateRide(db, {
        ride_id: params.ride_id as number,
        amount: params.amount as number | undefined,
        category: params.category as string | undefined,
        pickup: params.pickup as string | undefined,
        dropoff: params.dropoff as string | undefined,
      });
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    },
  });

  api.registerTool({
    name: "delete_ride",
    label: "Delete Ride",
    description: "Delete a ride record. This cannot be undone.",
    parameters: Type.Object({
      ride_id: Type.Number({ description: "ID of the ride to delete" }),
    }),
    async execute(_id, params) {
      const result = await handleDeleteRide(db, params.ride_id as number);
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    },
  });

  api.registerTool({
    name: "ride_spending_stats",
    label: "Ride Spending Stats",
    description:
      "Get ride spending statistics for a date range. Can break down by provider, category, or month.",
    parameters: Type.Object({
      start_date: Type.String({ description: "Start date (ISO 8601)" }),
      end_date: Type.String({ description: "End date (ISO 8601)" }),
      group_by: Type.Unsafe<"provider" | "category" | "month" | undefined>({
        type: "string",
        enum: ["provider", "category", "month"],
        description: "How to break down the stats (default: provider)",
      }),
    }),
    async execute(_id, params) {
      const result = await handleSpendingStats(db, {
        start_date: params.start_date as string,
        end_date: params.end_date as string,
        group_by: params.group_by as "provider" | "category" | "month" | undefined,
      });
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    },
  });

  api.registerTool({
    name: "set_ride_budget",
    label: "Set Ride Budget",
    description: "Set a monthly ride spending budget. This replaces any existing budget.",
    parameters: Type.Object({
      monthly_limit: Type.Number({ description: "Monthly limit in dollars (e.g., 500 for $500)" }),
      alert_threshold: Type.Optional(Type.Number({ description: "Alert when spending exceeds this fraction (0.0-1.0, default 0.8)" })),
      currency: Type.Unsafe<string | undefined>({
        type: "string",
        enum: ["SGD", "USD", "MYR"],
        description: `Budget currency. Defaults to ${config.defaultCurrency}. Changing currency recomputes all ride totals.`,
      }),
    }),
    async execute(_id, params) {
      const result = await handleSetBudget(db, config, {
        monthly_limit: params.monthly_limit as number,
        alert_threshold: params.alert_threshold as number | undefined,
        currency: params.currency as string | undefined,
      });
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    },
  });

  api.registerTool({
    name: "get_budget_status",
    label: "Get Budget Status",
    description:
      "Get current month's ride spending relative to the budget. Shows total spent, remaining, and whether the alert threshold has been exceeded.",
    parameters: Type.Object({}),
    async execute(_id) {
      const result = await handleGetBudgetStatus(db);
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    },
  });
}

export default definePluginEntry({
  id: "rides",
  name: "Rides Expenditure",
  description: "Track ride-hailing expenses from Grab, Gojek, and Zig",
  register(api) {
    const config = getConfig(api.pluginConfig);
    const stateDir = api.runtime.state.resolveStateDir();
    const dbPath = path.join(stateDir, "rides", "rides.db");
    const db = createDbClient(dbPath);
    const tokensPath = getTokensPath(dbPath);

    api.logger.info(`Initializing rides plugin, DB at: ${dbPath}`);
    runMigrations(db)
      .then(async () => {
        api.logger.info("Database migrations complete");
        // Migrate tokens from DB to file if they exist in DB but not in file
        if (!readTokens(tokensPath)) {
          const row = (await db.execute({
            sql: "SELECT gmail_access_token, gmail_refresh_token, gmail_token_expires_at FROM sync_state WHERE id = 1",
            args: [],
          })).rows[0];
          if (row?.gmail_access_token && row?.gmail_refresh_token) {
            writeTokens(tokensPath, {
              accessToken: row.gmail_access_token as string,
              refreshToken: row.gmail_refresh_token as string,
              expiresAt: Number(row.gmail_token_expires_at),
            });
            await db.execute({
              sql: "UPDATE sync_state SET gmail_access_token = NULL, gmail_refresh_token = NULL, gmail_token_expires_at = NULL WHERE id = 1",
              args: [],
            });
            api.logger.info("Migrated OAuth tokens from DB to tokens.json");
          }
        }
      })
      .catch((err) => api.logger.error(`Migration failed: ${err}`));

    registerRideTools(api, db, config);

    // OAuth routes
    const oauthConfig = {
      googleClientId: config.googleClientId,
      googleClientSecret: config.googleClientSecret,
      baseUrl: config.baseUrl,
    };
    api.registerHttpRoute({
      path: "/rides/gmail/auth",
      handler: createAuthHandler(db, oauthConfig),
      auth: "plugin",
      match: "exact",
    });
    api.registerHttpRoute({
      path: "/rides/gmail/callback",
      handler: createCallbackHandler(db, oauthConfig, tokensPath),
      auth: "plugin",
      match: "exact",
    });

    // Sync tool
    const syncConfig = {
      googleClientId: config.googleClientId,
      googleClientSecret: config.googleClientSecret,
      defaultCategory: config.defaultCategory,
      defaultCurrency: config.defaultCurrency,
    };

    api.registerTool({
      name: "sync_ride_emails",
      label: "Sync Ride Emails",
      description:
        "Sync ride receipts from Gmail. Fetches emails from Grab, Gojek, and Zig, extracts ride data, and saves new rides. Requires Gmail to be connected via OAuth. By default syncs only new emails since last sync. Use months parameter to sync historical emails.",
      parameters: Type.Object({
        provider: Type.Unsafe<string | undefined>({
          type: "string",
          enum: ["grab", "gojek", "zig"],
          description: "Only sync this specific provider. Omit to sync all.",
        }),
        months: Type.Optional(Type.Number({ description: "Number of months of history to sync (e.g., 6 for last 6 months). Omit to sync only new emails since last sync." })),
      }),
      async execute(_id, params) {
        const result = await handleSyncRideEmails(db, syncConfig, params.provider as string | undefined, params.months as number | undefined, tokensPath);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      },
    });

    // Screenshot tool
    api.registerTool({
      name: "parse_receipt_screenshot",
      label: "Parse Receipt Screenshot",
      description:
        "Extract ride data from a receipt screenshot. Send this tool a receipt image from Grab, Gojek, or Zig and it will extract the provider, amount, date, and locations. After extraction, ask the user to confirm before logging the ride.",
      parameters: Type.Object({
        image_url: Type.String({ description: "URL of the receipt image" }),
      }),
      async execute(_id, params) {
        const result = await handleParseReceiptScreenshot(
          params.image_url as string,
          config.googleAiApiKey,
        );
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      },
    });

    // Commands
    api.registerCommand(createRidesCommand(db));
    api.registerCommand(createRidesStatsCommand(db));
    api.registerCommand(
      createRidesSyncCommand(db, (months) => syncEmails(db, syncConfig, undefined, months, undefined, tokensPath)),
    );
    api.registerCommand(createRidesResetCommand(db));
    api.registerCommand(createRidesDisconnectCommand(db, tokensPath));

    // Notification hooks
    api.on("before_prompt_build", async (_event, _ctx) => {
      const syncErrors = await checkUnnotifiedSyncErrors(db);
      const gmailSetup = await checkGmailSetupNotification(db);
      const messages = [syncErrors, gmailSetup].filter((m): m is string => m != null);
      if (messages.length > 0) {
        api.logger.info(`[rides] injecting ${messages.length} notification(s) into prompt: ${messages.join(" | ")}`);
        return { appendSystemContext: messages.join("\n\n") };
      }
    });
  },
});
