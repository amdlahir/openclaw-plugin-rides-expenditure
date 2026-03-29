import * as path from "path";
import { createDbClient } from "./db/client";
import { runMigrations } from "./db/schema";
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
import { handleParseReceiptScreenshot } from "./tools/screenshot";
import {
  createRidesCommand,
  createRidesStatsCommand,
  createRidesSyncCommand,
} from "./commands/index";
import type { Client } from "@libsql/client";

type PluginApi = {
  id: string;
  pluginConfig?: Record<string, unknown>;
  runtime: {
    state: {
      resolveStateDir: () => string;
    };
  };
  logger: {
    info: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  };
  registerTool: (tool: unknown) => void;
  registerCommand: (command: unknown) => void;
  registerHttpRoute: (route: unknown) => void;
  registerService: (service: unknown) => void;
  on: (event: string, handler: unknown, opts?: unknown) => void;
};

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

// Helper to wrap handler as AgentTool execute signature: (toolCallId, params) => Promise<AgentToolResult>
function wrapExecute(handler: (params: Record<string, unknown>) => Promise<unknown>) {
  return async (_toolCallId: string, params: Record<string, unknown>) => {
    const result = await handler(params);
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  };
}

function registerRideTools(api: PluginApi, db: Client, config: ReturnType<typeof getConfig>) {
  api.registerTool({
    name: "log_ride",
    label: "Log Ride",
    description:
      "Log a ride-hailing trip from Grab or Gojek. Use this when the user tells you about a ride they took.",
    parameters: {
      type: "object",
      required: ["provider", "amount"],
      properties: {
        provider: {
          type: "string",
          enum: ["grab", "gojek"],
          description: "Ride-hailing provider",
        },
        amount: {
          type: "number",
          description: "Fare amount (e.g., 15.50, not cents)",
        },
        currency: {
          type: "string",
          enum: ["SGD", "USD", "MYR"],
          description: `Currency code. Defaults to ${config.defaultCurrency}.`,
        },
        date: {
          type: "string",
          description: "Trip date in ISO 8601 format. Defaults to now.",
        },
        pickup: { type: "string", description: "Pickup location" },
        dropoff: { type: "string", description: "Dropoff location" },
        category: {
          type: "string",
          enum: ["work", "personal"],
          description: `Trip category. Defaults to ${config.defaultCategory}.`,
        },
      },
    },
    execute: wrapExecute((params) =>
      handleLogRide(db, config, {
        provider: params.provider as string,
        amount: params.amount as number,
        currency: params.currency as string | undefined,
        date: params.date as string | undefined,
        pickup: params.pickup as string | undefined,
        dropoff: params.dropoff as string | undefined,
        category: params.category as string | undefined,
      }),
    ),
  });

  api.registerTool({
    name: "list_rides",
    label: "List Rides",
    description:
      "List recent ride-hailing trips. Supports filtering by provider, category, and date range.",
    parameters: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          description: "Max rides to return (default 10, max 50)",
        },
        provider: {
          type: "string",
          enum: ["grab", "gojek"],
          description: "Filter by provider",
        },
        category: {
          type: "string",
          enum: ["work", "personal"],
          description: "Filter by category",
        },
        start_date: {
          type: "string",
          description: "Start date filter (ISO 8601)",
        },
        end_date: {
          type: "string",
          description: "End date filter (ISO 8601)",
        },
      },
    },
    execute: wrapExecute((params) =>
      handleListRides(db, {
        limit: params.limit as number | undefined,
        provider: params.provider as string | undefined,
        category: params.category as string | undefined,
        start_date: params.start_date as string | undefined,
        end_date: params.end_date as string | undefined,
      }),
    ),
  });

  api.registerTool({
    name: "search_rides",
    label: "Search Rides",
    description:
      "Search rides by pickup or dropoff location. Use when the user asks about rides to/from a specific place.",
    parameters: {
      type: "object",
      required: ["query"],
      properties: {
        query: {
          type: "string",
          description: "Location search term (e.g., 'Orchard', 'MBS', 'Airport')",
        },
        limit: {
          type: "number",
          description: "Max results (default 10)",
        },
      },
    },
    execute: wrapExecute((params) =>
      handleSearchRides(db, {
        query: params.query as string,
        limit: params.limit as number | undefined,
      }),
    ),
  });

  api.registerTool({
    name: "update_ride",
    label: "Update Ride",
    description: "Update details of an existing ride (amount, category, locations).",
    parameters: {
      type: "object",
      required: ["ride_id"],
      properties: {
        ride_id: { type: "number", description: "ID of the ride to update" },
        amount: { type: "number", description: "New fare amount" },
        category: { type: "string", enum: ["work", "personal"] },
        pickup: { type: "string", description: "New pickup location" },
        dropoff: { type: "string", description: "New dropoff location" },
      },
    },
    execute: wrapExecute((params) =>
      handleUpdateRide(db, {
        ride_id: params.ride_id as number,
        amount: params.amount as number | undefined,
        category: params.category as string | undefined,
        pickup: params.pickup as string | undefined,
        dropoff: params.dropoff as string | undefined,
      }),
    ),
  });

  api.registerTool({
    name: "delete_ride",
    label: "Delete Ride",
    description: "Delete a ride record. This cannot be undone.",
    parameters: {
      type: "object",
      required: ["ride_id"],
      properties: {
        ride_id: { type: "number", description: "ID of the ride to delete" },
      },
    },
    execute: wrapExecute((params) =>
      handleDeleteRide(db, params.ride_id as number),
    ),
  });

  api.registerTool({
    name: "ride_spending_stats",
    label: "Ride Spending Stats",
    description:
      "Get ride spending statistics for a date range. Can break down by provider, category, or month.",
    parameters: {
      type: "object",
      required: ["start_date", "end_date"],
      properties: {
        start_date: { type: "string", description: "Start date (ISO 8601)" },
        end_date: { type: "string", description: "End date (ISO 8601)" },
        group_by: {
          type: "string",
          enum: ["provider", "category", "month"],
          description: "How to break down the stats (default: provider)",
        },
      },
    },
    execute: wrapExecute((params) =>
      handleSpendingStats(db, {
        start_date: params.start_date as string,
        end_date: params.end_date as string,
        group_by: params.group_by as "provider" | "category" | "month" | undefined,
      }),
    ),
  });

  api.registerTool({
    name: "set_ride_budget",
    label: "Set Ride Budget",
    description: "Set a monthly ride spending budget. This replaces any existing budget.",
    parameters: {
      type: "object",
      required: ["monthly_limit"],
      properties: {
        monthly_limit: {
          type: "number",
          description: "Monthly limit in dollars (e.g., 500 for $500)",
        },
        alert_threshold: {
          type: "number",
          description: "Alert when spending exceeds this fraction (0.0-1.0, default 0.8)",
        },
        currency: {
          type: "string",
          enum: ["SGD", "USD", "MYR"],
          description: `Budget currency. Defaults to ${config.defaultCurrency}. Changing currency recomputes all ride totals.`,
        },
      },
    },
    execute: wrapExecute((params) =>
      handleSetBudget(db, config, {
        monthly_limit: params.monthly_limit as number,
        alert_threshold: params.alert_threshold as number | undefined,
        currency: params.currency as string | undefined,
      }),
    ),
  });

  api.registerTool({
    name: "get_budget_status",
    label: "Get Budget Status",
    description:
      "Get current month's ride spending relative to the budget. Shows total spent, remaining, and whether the alert threshold has been exceeded.",
    parameters: { type: "object", properties: {} },
    execute: wrapExecute(() => handleGetBudgetStatus(db)),
  });
}

export default {
  register(api: PluginApi) {
    const config = getConfig(api.pluginConfig);
    const stateDir = api.runtime.state.resolveStateDir();
    const dbPath = path.join(stateDir, "rides", "rides.db");
    const db = createDbClient(dbPath);

    api.logger.info("Initializing rides plugin, DB at:", dbPath);
    runMigrations(db)
      .then(() => api.logger.info("Database migrations complete"))
      .catch((err) => api.logger.error("Migration failed:", err));

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
      handler: createCallbackHandler(db, oauthConfig),
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
        "Sync ride receipts from Gmail. Fetches emails from Grab and Gojek, extracts ride data, and saves new rides. Requires Gmail to be connected via OAuth. By default syncs only new emails since last sync. Use months parameter to sync historical emails.",
      parameters: {
        type: "object",
        properties: {
          provider: {
            type: "string",
            enum: ["grab", "gojek"],
            description: "Only sync this specific provider. Omit to sync all.",
          },
          months: {
            type: "number",
            description: "Number of months of history to sync (e.g., 6 for last 6 months). Omit to sync only new emails since last sync.",
          },
        },
      },
      execute: wrapExecute((params) =>
        handleSyncRideEmails(db, syncConfig, params.provider as string | undefined, params.months as number | undefined),
      ),
    });

    // Screenshot tool
    api.registerTool({
      name: "parse_receipt_screenshot",
      label: "Parse Receipt Screenshot",
      description:
        "Extract ride data from a receipt screenshot. Send this tool a receipt image from Grab or Gojek and it will extract the provider, amount, date, and locations. After extraction, ask the user to confirm before logging the ride.",
      parameters: {
        type: "object",
        required: ["image_url"],
        properties: {
          image_url: {
            type: "string",
            description: "URL of the receipt image",
          },
        },
      },
      execute: wrapExecute((params) =>
        handleParseReceiptScreenshot(
          params.image_url as string,
          config.googleAiApiKey,
        ),
      ),
    });

    // Commands
    api.registerCommand(createRidesCommand(db));
    api.registerCommand(createRidesStatsCommand(db));
    api.registerCommand(
      createRidesSyncCommand(db, (months) => syncEmails(db, syncConfig, undefined, months)),
    );

    // Parse failure notification hook
    api.on("session_start", async () => {
      const message = await checkUnnotifiedSyncErrors(db);
      if (message) {
        return { appendSystemContext: message };
      }
    });
  },
};
