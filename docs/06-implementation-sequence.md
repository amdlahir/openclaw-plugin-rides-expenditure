# Implementation Sequence

## Phase 1 — Foundation

**Goal:** Plugin loads, DB initializes, basic structure in place.

### Files to create:

1. **`package.json`**
   - Name: `openclaw-plugin-rides-expenditure`
   - Dependencies: `@libsql/client`, `zod`
   - `openclaw.extensions`: `["./src/index.ts"]` (loaded directly via jiti, no build step)

2. **`openclaw.plugin.json`**
   - Plugin manifest with `id` and `configSchema`
   - See `03-plugin-api-surface.md` for full schema

3. **`src/types.ts`** — Copy from `packages/shared/src/types.ts`

4. **`src/constants.ts`** — Copy from `packages/shared/src/constants.ts`

5. **`src/db/schema.ts`** — SQL DDL constants + `runMigrations(db)` function
   - All `CREATE TABLE IF NOT EXISTS` statements
   - All index creation
   - Seed `sync_state` singleton row

6. **`src/db/client.ts`** — `createDbClient(dbPath)` factory
   - Creates directory if not exists
   - Returns `@libsql/client` `Client` instance

7. **`src/index.ts`** — Skeleton plugin definition
   - Resolve DB path via `api.runtime.state.resolveStateDir()`
   - Initialize DB client + run migrations
   - Export default `OpenClawPluginDefinition`

### Verification:
- Plugin loads without errors when OpenClaw starts
- DB file created at expected path with all tables

---

## Phase 2 — Ride Management Tools

**Goal:** Users can manually log, list, search, update, and delete rides via the AI agent.

### Files to create:

8. **`src/tools/rides.ts`** — 6 tools:
   - `log_ride` — INSERT with amount conversion (dollars→cents), date parsing, default category
   - `list_rides` — SELECT with optional filters (provider, category, date range), pagination
   - `ride_spending_stats` — GROUP BY aggregation with dynamic grouping (provider/category/month)
   - `search_rides` — LIKE query on pickup/dropoff
   - `update_ride` — UPDATE with `manually_edited = 1`
   - `delete_ride` — DELETE by id

### Wire up in `src/index.ts`:
- Register all 6 tools via `api.registerTool()`

### Verification:
- Chat: "Log a Grab ride for $15.50 from Orchard to Bugis" → ride inserted
- Chat: "Show my recent rides" → list returned
- Chat: "How much did I spend this month?" → stats returned
- Chat: "Delete ride 1" → ride removed

---

## Phase 3 — Budget Tools

**Goal:** Users can set monthly spending limits and check budget status.

### Files to create:

9. **`src/tools/budget.ts`** — 2 tools:
    - `set_ride_budget` — DELETE all + INSERT (UPSERT pattern)
    - `get_budget_status` — Current month aggregation + budget comparison

### Wire up in `src/index.ts`:
- Register both tools

### Verification:
- Chat: "Set my monthly ride budget to $500" → budget saved
- Chat: "What's my budget status?" → shows spent/limit/remaining

---

## Phase 4 — Email Parsers + Gmail API

**Goal:** Email parsing and Gmail API layer ready (but not yet wired to sync).

### Files to create:

10. **`src/parsers/emailParser.ts`** — Copy verbatim from `packages/shared/src/utils/emailParser.ts`

11. **`src/gmail/api.ts`** — Extract from `packages/convex/convex/emailSync.ts`:
    - `refreshGmailToken(refreshToken, clientId, clientSecret)`
    - `fetchGmailMessages(accessToken, providerEmail, afterDate?)`
    - `fetchMessageDetail(accessToken, messageId)`
    - `decodeBase64Url(data)`
    - `extractEmailBody(message)`
    - All related type interfaces

12. **`src/gmail/oauth.ts`** — Extract and adapt:
    - `buildGmailAuthUrl(config)` — returns URL string
    - `exchangeCodeForTokens(code, config)` — returns `{ accessToken, refreshToken, expiresAt }`

### Verification:
- Unit tests for email parsers (port existing tests if available)
- Type-check passes

---

## Phase 5 — OAuth Routes

**Goal:** User can connect their Gmail account via OAuth.

### Files to create:

13. **`src/routes/oauth.ts`** — HTTP handlers:
    - `handleGmailAuth(req, res)` — redirects to Google OAuth
    - `handleGmailCallback(req, res)` — exchanges code, stores tokens in `sync_state`

### Wire up in `src/index.ts`:
- Register both routes via `api.registerHttpRoute()`

### Verification:
- Navigate to `{baseUrl}/rides/gmail/auth` → redirects to Google consent
- Complete OAuth flow → tokens stored in `sync_state`, `email_sync_enabled = 1`

---

## Phase 6 — Email Sync

**Goal:** Emails are automatically synced on a schedule, and on-demand via tool/command.

### Files to create:

14. **`src/gmail/sync.ts`** — Core sync orchestration:
    - `syncEmails(db, config, provider?)` — full sync cycle
    - Reads tokens from `sync_state`
    - Refreshes if needed
    - Loops providers, fetches messages, parses, inserts
    - Updates `last_sync_at`, creates `sync_logs` entry

15. **`src/services/emailSync.ts`** — Background service:
    - `start()` — check sync_state, immediate sync, setInterval
    - `stop()` — clearInterval

16. **`src/tools/sync.ts`** — `sync_ride_emails` tool:
    - Calls `syncEmails()` directly

### Wire up in `src/index.ts`:
- Register service via `api.registerService()`
- Register sync tool via `api.registerTool()`

### Verification:
- Chat: "Sync my ride emails" → triggers sync, reports results
- Background service runs every N minutes (check logs)
- Duplicate emails are silently skipped (INSERT OR IGNORE)

---

## Phase 7 — Screenshot Parsing

**Goal:** Users can send receipt images for OCR extraction.

### Files to create:

17. **`src/parsers/screenshotParser.ts`** — Copy from `packages/shared/src/utils/screenshotParser.ts`

18. **`src/tools/screenshot.ts`** — `parse_receipt_screenshot` tool:
    - Check `googleAiApiKey` is configured
    - Fetch image from URL
    - Send to Gemini 2.0 Flash
    - Validate response
    - Return extracted data (agent handles confirmation dialog)

### Wire up in `src/index.ts`:
- Register screenshot tool (conditionally, only if `googleAiApiKey` is set)

### Dependency:
- Add `@google/generative-ai` to `package.json`

### Verification:
- Send receipt image via messaging channel
- Agent extracts provider, amount, date, locations
- Agent asks for confirmation, then logs ride

---

## Phase 8 — Commands

**Goal:** Quick-access slash commands for common operations.

### Files to create:

19. **`src/commands/index.ts`** — 3 commands:
    - `/rides` — formatted table of last 10 rides
    - `/rides-stats` — monthly spending summary
    - `/rides-sync` — trigger sync, report results

### Wire up in `src/index.ts`:
- Register all 3 commands via `api.registerCommand()`

### Verification:
- Type `/rides` in any channel → formatted ride list
- Type `/rides-stats` → monthly summary with budget
- Type `/rides-sync` → sync runs and reports

---

## Phase 9 — System Prompt Hook

**Goal:** AI agent knows about ride tracking capabilities without being told.

### Add to `src/index.ts`:
- Register `before_prompt_build` hook with `appendSystemContext`

### Verification:
- Chat: "How much did I spend on rides?" → agent uses tools without needing explicit instructions

---

## Dependency Summary

```
Phase 1 ──→ Phase 2 ──→ Phase 3
  │
  ├──→ Phase 4 ──→ Phase 5 ──→ Phase 6
  │
  └──→ Phase 7 (depends on Phase 4 for screenshotParser.ts types)

Phase 8 depends on Phase 2 + Phase 6 (reuses same DB queries)
Phase 9 is independent (can be added at any phase)
```

Phases 2-3 and Phases 4-5 can be developed in parallel.
