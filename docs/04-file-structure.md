# File Structure

## Project Layout

```
/home/amin/projects/openclaw-plugin-rides-expenditure/
├── openclaw.plugin.json              # Plugin manifest (id, configSchema, skills)
├── package.json                      # NPM package with openclaw.extensions
├── skills/
│   └── rides-tracking/
│       └── SKILL.md                  # Agent skill: how to use ride tracking tools
├── src/
│   ├── index.ts                      # Plugin entry: default export with register()
│   │
│   ├── types.ts                      # Zod schemas: Provider, Category, RideSource, ExtractedRide
│   ├── constants.ts                  # Provider emails, colors, sync interval, defaults
│   │
│   ├── db/
│   │   ├── client.ts                 # libSQL client singleton factory
│   │   └── schema.ts                 # SQL DDL strings + runMigrations() function
│   │
│   ├── parsers/
│   │   ├── emailParser.ts            # Regex parsers: parseGrabReceipt, parseGojekReceipt, parseTadaReceipt
│   │   └── screenshotParser.ts       # Gemini response helpers: parseGeminiResponse, validateExtractionResult, etc.
│   │
│   ├── gmail/
│   │   ├── api.ts                    # Gmail API helpers: refreshGmailToken, fetchGmailMessages,
│   │   │                             #   fetchMessageDetail, decodeBase64Url, extractEmailBody
│   │   ├── oauth.ts                  # OAuth URL builder + token exchange logic
│   │   └── sync.ts                   # Sync orchestration: syncEmails(db, config, provider?)
│   │
│   ├── tools/
│   │   ├── rides.ts                  # Tools: log_ride, list_rides, ride_spending_stats,
│   │   │                             #   search_rides, update_ride, delete_ride
│   │   ├── budget.ts                 # Tools: set_ride_budget, get_budget_status
│   │   ├── sync.ts                   # Tool: sync_ride_emails
│   │   └── screenshot.ts            # Tool: parse_receipt_screenshot
│   │
│   ├── commands/
│   │   └── index.ts                  # Commands: /rides, /rides-stats, /rides-sync
│   │
│   ├── routes/
│   │   └── oauth.ts                  # HTTP handlers: handleGmailAuth, handleGmailCallback
│   │
│   └── services/
│       └── emailSync.ts              # Background service: start/stop with setInterval
│
└── tests/                            # (optional, for future implementation)
    ├── parsers/
    │   └── emailParser.test.ts
    └── db/
        └── schema.test.ts
```

## File Responsibilities

### Entry Point

| File | Lines (est.) | Responsibility |
|------|-------------|----------------|
| `src/index.ts` | ~70 | Plugin definition + `register()`. Initializes DB, registers all tools/commands/routes/services. |
| `skills/rides-tracking/SKILL.md` | ~60 | Agent skill definition. Teaches the LLM when and how to use ride tracking tools. |

### Core Data Layer

| File | Lines (est.) | Responsibility |
|------|-------------|----------------|
| `src/types.ts` | ~30 | Zod schemas (direct copy from `packages/shared/src/types.ts`) |
| `src/constants.ts` | ~25 | Provider config, default values (direct copy from `packages/shared/src/constants.ts`) |
| `src/db/client.ts` | ~40 | `createDbClient(dbPath)` — returns `@libsql/client` instance. Lazy singleton pattern. |
| `src/db/schema.ts` | ~80 | SQL DDL constants + `runMigrations(db)` function. Idempotent `CREATE TABLE IF NOT EXISTS`. |

### Parsers (Pure Functions — Direct Copy)

| File | Lines (est.) | Source | Adaptation |
|------|-------------|--------|------------|
| `src/parsers/emailParser.ts` | ~360 | `packages/shared/src/utils/emailParser.ts` | **None.** Pure regex functions, zero dependencies. Copy verbatim. |
| `src/parsers/screenshotParser.ts` | ~170 | `packages/shared/src/utils/screenshotParser.ts` | **Minimal.** Inline the `ExtractionResultSchema` import from `types.ts` (already in our `types.ts`). |

### Gmail Integration

| File | Lines (est.) | Source | Adaptation |
|------|-------------|--------|------------|
| `src/gmail/api.ts` | ~120 | `packages/convex/convex/emailSync.ts` lines 137-251 | **None.** Pure `fetch`-based functions. Copy verbatim: `refreshGmailToken`, `fetchGmailMessages`, `fetchMessageDetail`, `decodeBase64Url`, `extractEmailBody`. Also copy the `GmailMessage`, `GmailMessageDetail` type interfaces. |
| `src/gmail/oauth.ts` | ~60 | `apps/web/src/app/api/gmail/route.ts` + `callback/route.ts` | **Moderate.** Extract the URL-building and token-exchange logic. Remove Clerk auth and Next.js wrappers. Pure functions: `buildAuthUrl(config)`, `exchangeCodeForTokens(code, config)`. |
| `src/gmail/sync.ts` | ~120 | `packages/convex/convex/emailSync.ts` lines 589-720 | **Substantial.** Replace all `ctx.runMutation` / `ctx.runQuery` calls with direct libSQL queries. Remove `userId` parameter. Simplify to single-user flow. Core logic (provider loop, parse, insert) stays identical. |

### Tools (OpenClaw AI Agent Interface)

| File | Lines (est.) | Responsibility |
|------|-------------|----------------|
| `src/tools/rides.ts` | ~250 | 6 ride management tools. Each tool is an `AnyAgentTool` with JSON Schema parameters + handler function. SQL queries against `rides` table. |
| `src/tools/budget.ts` | ~100 | 2 budget tools. UPSERT pattern for `budgets` table. Budget status computes current month aggregation. |
| `src/tools/sync.ts` | ~40 | 1 sync tool. Thin wrapper around `gmail/sync.ts`. |
| `src/tools/screenshot.ts` | ~100 | 1 screenshot tool. Fetches image, calls Gemini, validates response. Gated on `googleAiApiKey` config. |

### Commands (Direct Slash Commands)

| File | Lines (est.) | Responsibility |
|------|-------------|----------------|
| `src/commands/index.ts` | ~120 | 3 commands (`/rides`, `/rides-stats`, `/rides-sync`). Each returns formatted text. Reuses same DB queries as tools but with pre-formatted output. |

### Routes (HTTP)

| File | Lines (est.) | Responsibility |
|------|-------------|----------------|
| `src/routes/oauth.ts` | ~80 | 2 HTTP handlers for Gmail OAuth. Uses Node.js `IncomingMessage`/`ServerResponse`. Reads config from closure, writes tokens to `sync_state` via libSQL. |

### Services (Background)

| File | Lines (est.) | Responsibility |
|------|-------------|----------------|
| `src/services/emailSync.ts` | ~60 | Background email sync service. `start()` checks sync_state, sets up `setInterval`. `stop()` clears interval. Delegates actual sync to `gmail/sync.ts`. |

## Estimated Total: ~1,700 lines

- ~530 lines are direct copies (parsers + gmail/api.ts + types + constants)
- ~500 lines are tool definitions (mostly JSON Schema boilerplate + SQL)
- ~670 lines are adapted/new code (DB layer, sync orchestration, routes, service, commands, entry point)
