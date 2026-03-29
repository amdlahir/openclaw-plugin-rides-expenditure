# PRD: OpenClaw Rides Plugin

## Problem Statement

Ride-hailing expense tracking currently requires a separate SaaS application (Convex + Next.js + Clerk) with its own deployment, authentication, and web UI. This creates friction: the user must switch between their messaging channels (where they communicate with OpenClaw) and a standalone web app to manage ride expenses. The SaaS architecture also introduces unnecessary complexity for what is fundamentally a single-user workflow — hosted database, authentication layer, and frontend deployment are all overhead for one person tracking their own rides.

## Solution

Replace the standalone SaaS app with an OpenClaw plugin (`rides`) that integrates ride-hailing expense tracking directly into the user's existing chat-based workflow. The user interacts with ride tracking through natural language conversations, slash commands, and image attachments — all within the messaging channels they already use (WhatsApp, Telegram, Slack, etc.).

The plugin runs entirely on the user's own OpenClaw instance with a local SQLite database. No external hosting, no authentication, no separate UI. Rides can be logged manually via chat, extracted from receipt screenshots using Gemini Vision, or automatically synced from Gmail receipts.

Multi-currency support is built in from day one: rides are stored in their original currency and normalized to the user's chosen budget currency using live exchange rates.

## User Stories

1. As an OpenClaw user, I want to log a ride by telling the agent "I took a Grab for $15 from Orchard to Bugis", so that I can record expenses without leaving my chat.
2. As an OpenClaw user, I want to log rides in any supported currency (SGD, USD, MYR), so that I can track expenses across countries.
3. As an OpenClaw user, I want the plugin to default to my configured currency when I don't specify one, so that logging rides is quick and frictionless.
4. As an OpenClaw user, I want to log a ride with any provider (Grab, Gojek) and any currency, so that I'm not restricted by provider-currency pairings.
5. As an OpenClaw user, I want to list my recent rides with optional filters (provider, category, date range), so that I can review my ride history.
6. As an OpenClaw user, I want to search rides by pickup or dropoff location, so that I can find specific trips.
7. As an OpenClaw user, I want to update a ride's details (amount, category, locations), so that I can correct errors.
8. As an OpenClaw user, I want to delete a ride, so that I can remove incorrect records.
9. As an OpenClaw user, I want to see spending statistics grouped by provider, category, or month, so that I can understand my spending patterns.
10. As an OpenClaw user, I want to set a monthly ride budget in my chosen currency, so that I can control my spending.
11. As an OpenClaw user, I want to check my budget status (spent, remaining, percentage), so that I know where I stand this month.
12. As an OpenClaw user, I want to be warned when I exceed my budget alert threshold, so that I can adjust my behavior.
13. As an OpenClaw user, I want to change my budget currency and have all historical rides recomputed to the new currency, so that my data stays consistent.
14. As an OpenClaw user, I want to connect my Gmail account via OAuth, so that ride receipts can be synced automatically.
15. As an OpenClaw user, I want the OAuth flow to work whether my OpenClaw runs on localhost or a public URL, so that setup works regardless of my deployment.
16. As an OpenClaw user, I want ride receipt emails from Grab and Gojek to be automatically synced from Gmail on a configurable interval, so that I don't have to log rides manually.
17. As an OpenClaw user, I want to trigger an email sync on demand, so that I can pull in recent receipts immediately.
18. As an OpenClaw user, I want duplicate emails to be silently skipped during sync, so that I don't get duplicate ride records.
19. As an OpenClaw user, I want to be notified at the start of my next session if email sync encountered parse failures, so that I'm aware of issues without having to check logs.
20. As an OpenClaw user, I want to send a receipt screenshot and have the plugin extract ride data using Gemini Vision, so that I can log rides from images.
21. As an OpenClaw user, I want the agent to present extracted screenshot data for confirmation before logging, so that I can verify accuracy.
22. As an OpenClaw user, I want to type `/rides` for a quick formatted table of recent rides, so that I can glance at my history without invoking the AI agent.
23. As an OpenClaw user, I want to type `/rides-stats` for a monthly spending summary, so that I get instant stats.
24. As an OpenClaw user, I want to type `/rides-sync` to trigger email sync and see results, so that I can sync without a conversation.
25. As an OpenClaw user, I want the AI agent to know about ride tracking capabilities without me having to explain them, so that conversations feel natural.
26. As an OpenClaw user, I want exchange rates to be cached and refreshed daily, so that currency conversion is fast and doesn't depend on constant API availability.
27. As an OpenClaw user, I want the plugin to still accept rides when the exchange rate API is unavailable, storing them with a null normalized amount to be backfilled later, so that I never lose data.
28. As an OpenClaw user, I want rides stored with both their original currency/amount and a normalized amount in my budget currency, so that I have accurate records and consistent aggregation.

## Implementation Decisions

### Plugin Identity
- Plugin ID: `rides`
- State directory: `~/.openclaw/rides/`
- Database: `~/.openclaw/rides/rides.db`
- No build step — TypeScript loaded directly via jiti

### Providers
- Grab and Gojek only. Tada is dropped.
- Providers are not coupled to currencies — any provider can be logged with any supported currency.

### Currency Model
- Supported currencies: SGD, USD, MYR (extensible later)
- Dual-amount storage: every ride stores `original_amount` + `original_currency` AND `normalized_amount` + `normalized_currency` (the user's budget currency)
- `normalized_amount` can be NULL when the exchange rate API is unavailable at insert time
- A backfill mechanism recomputes NULL normalized amounts when rates become available
- When the user changes their budget currency, ALL historical `normalized_amount` values are recomputed using current exchange rates
- `defaultCurrency` in plugin config serves as both the budget currency and the assumed currency for manual ride logging when unspecified

### Exchange Rates
- Source: Frankfurter API (free, open-source, no API key, ECB-backed)
- Cached in an `exchange_rates` table with `from_currency`, `to_currency`, `rate`, `fetched_at`
- Cache TTL: 24 hours — fetch fresh rates once per day
- Fallback: if API is unreachable and no cached rate exists, insert ride with `normalized_amount = NULL`
- No additional API key configuration required

### Database Schema Changes (vs original docs)
- `rides` table: replace `amount`/`currency` with `original_amount INTEGER`, `original_currency TEXT`, `normalized_amount INTEGER` (nullable), `normalized_currency TEXT`
- New table: `exchange_rates` with `from_currency`, `to_currency`, `rate REAL`, `fetched_at INTEGER`
- `budgets` table: `currency` is user-configurable (not hardcoded to SGD)
- `sync_logs` table: add `notified_at INTEGER` column for tracking parse failure notifications
- All amounts remain in cents (integer). All timestamps in Unix milliseconds.

### Email Parsing
- Grab SGD parser: verbatim copy from original
- Gojek SGD parser: verbatim copy from original (strip IDR/THB/VND handling)
- Grab MYR parser: skeleton implementation with general regex patterns, to be refined when real email samples are available
- Deduplication via `UNIQUE` constraint on `raw_email_id` + `INSERT OR IGNORE`

### Parse Failure Notifications
- Background sync service stores errors in `sync_logs.errors` as before
- A hook registered on `session_start` checks for `sync_logs` rows where `errors` is non-empty and `notified_at` is NULL
- If unnotified failures exist, the hook surfaces them as agent context so the agent informs the user
- After surfacing, the hook updates `notified_at` on those rows

### Screenshot Processing
- Single-step: `parse_receipt_screenshot` tool extracts data, agent presents for confirmation, then calls `log_ride`
- No image storage — processed in-memory
- Gated on `googleAiApiKey` config — returns descriptive error if not configured
- Uses Gemini 2.0 Flash

### OAuth
- Works on both localhost (`http://localhost:PORT`) and public URLs
- Google OAuth supports `http://localhost` redirect URIs without HTTPS
- For localhost: "Web application" client type with exact `http://localhost:PORT/rides/gmail/callback` registered in Google Cloud Console
- CSRF protection via random nonce in `sync_state` table
- Single-user: no user identity in OAuth state parameter

### Commands vs Tools
- Commands (`/rides`, `/rides-stats`, `/rides-sync`) are instant, no LLM invocation
- Tools are flexible, LLM-driven, support natural language queries
- Both coexist — commands for quick access, tools for conversational interaction

### Background Sync Service
- Uses `setInterval` inside `api.registerService()` start/stop lifecycle
- Configurable interval via `syncIntervalMinutes` (default 15)
- `last_sync_at` persisted in `sync_state` — no data loss on restart, just delayed sync
- Token refresh with 5-minute buffer before expiry

### Agent Skill
- `SKILL.md` in `skills/rides-tracking/` teaches the agent about plugin capabilities
- Declarative — no code execution, loaded automatically by OpenClaw
- Covers: when to use tools, available tools, example flows, supported providers

## Testing Decisions

### Testing Philosophy
- Test external behavior, not implementation details
- Pure functions get thorough unit tests
- Stateful flows get integration tests with a real SQLite database (not mocks)
- Thin glue code and formatting are not worth unit testing

### High Priority (Unit Tests)
- **Email parsers** — Pure regex functions, highest risk of edge-case breakage. Test each provider parser with valid receipts, malformed input, edge cases (multiple amounts, missing fields). Include skeleton MYR parser tests that document expected behavior once real samples arrive.
- **Currency conversion** — New financial logic. Test: conversion with cached rates, cache miss triggers fetch, API failure with existing cache uses stale rate, API failure with no cache returns NULL, backfill logic, recompute-all on currency change.
- **Screenshot parser utilities** — Pure validation/normalization functions. Test: valid/invalid provider, amount boundaries, confidence clamping, date normalization, MIME type validation.

### Medium Priority (Integration Tests)
- **DB schema + migrations** — Test that all tables create correctly, idempotent re-runs don't fail, seed data (sync_state singleton) is present.
- **Sync orchestration** — Test happy path (fetch → parse → insert → update sync state), token refresh flow, dedup (same email ID skipped), error accumulation. Mock Gmail API HTTP responses, use real SQLite.

### Low Priority (Integration Tests)
- **Tools** — Integration-test key round-trips: `log_ride` then `list_rides` returns the ride, `set_ride_budget` then `get_budget_status` reflects it, `delete_ride` then `list_rides` excludes it.

### Skip
- **OAuth routes** — Depend on external Google endpoints. Test manually.
- **Commands** — Output formatting. Not worth automated tests.

## Out of Scope

- **Multi-user / multi-tenancy** — Plugin is single-user by design. No `userId` columns, no auth.
- **IDR, THB, VND currencies** — Stripped from parsers. Only SGD, USD, MYR for v1.
- **Tada provider** — Dropped. Only Grab and Gojek.
- **Historical exchange rates** — Currency change recomputes using current rates, not rates valid at each ride's original date.
- **Image storage** — Screenshots processed in-memory, not persisted.
- **Data migration from existing SaaS** — Starting fresh.
- **React/web UI** — All interaction is chat-based (tools, commands, agent).
- **Real-time reactive queries** — Tools are request/response, not live-updating.
- **Offline exchange rate seeding** — If Frankfurter is down on first use, normalized amounts are NULL until API is reachable.

## Further Notes

- The repo name is `openclaw-plugin-rides-expenditure` but the plugin ID is `rides`. The repo can be renamed later if desired.
- ~48% of the codebase is directly copied or minimally adapted from the original `rides-expenditure-tracker` project. The email parsers, screenshot parser utilities, Gmail API helpers, types, and constants are all portable pure functions.
- The MYR Grab email parser is intentionally a skeleton. When real Malaysian Grab receipt emails are available, the regex patterns should be refined and the skeleton tests updated with real fixtures.
- The Frankfurter API has no authentication, no rate limits for reasonable usage, and is backed by ECB data. If it ever shuts down, swapping to another provider requires changing one URL and possibly the response parsing — the caching and fallback logic remains the same.
- The `session_start` hook for parse failure notifications requires verifying that OpenClaw exposes this hook event. If not available, fall back to surfacing errors in tool responses.
