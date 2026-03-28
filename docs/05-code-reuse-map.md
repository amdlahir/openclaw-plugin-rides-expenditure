# Code Reuse Map

## Overview

This document maps every source file from the original `rides-expenditure-tracker` project to its corresponding file in the OpenClaw plugin, with the exact adaptation required.

**Legend:**
- **VERBATIM** — Copy as-is, no changes needed
- **MINIMAL** — Small import path changes, no logic changes
- **MODERATE** — Framework wrappers removed, core logic preserved
- **SUBSTANTIAL** — Core logic preserved but significant structural changes (Convex → libSQL)
- **NEW** — No corresponding source in original project

---

## Direct Copies (VERBATIM / MINIMAL)

### 1. Email Parsers

| Source | Target | Adaptation |
|--------|--------|------------|
| `packages/shared/src/utils/emailParser.ts` (359 lines) | `src/parsers/emailParser.ts` | **VERBATIM** |

All three parser functions (`parseGrabReceipt`, `parseGojekReceipt`, `parseTadaReceipt`) and the `ParsedRide` / `RideProvider` types are pure functions with zero external dependencies. Copy the entire file unchanged.

**Key functions preserved:**
- `parseGrabReceipt(emailBody, internalDate)` — SGD amount extraction, pickup/dropoff regex, confidence scoring
- `parseGojekReceipt(emailBody, internalDate)` — SGD + IDR support, bilingual patterns (English + Indonesian)
- `parseTadaReceipt(emailBody, internalDate)` — Multi-currency (SGD, THB, VND, USD), regional patterns

### 2. Screenshot Parser Utilities

| Source | Target | Adaptation |
|--------|--------|------------|
| `packages/shared/src/utils/screenshotParser.ts` (166 lines) | `src/parsers/screenshotParser.ts` | **MINIMAL** |

Change: Update import path from `"../types"` to `"../types"` (same relative path, but verify it resolves in new project structure).

**Functions preserved:**
- `validateExtractionResult(rawResponse)` — Zod-based validation
- `parseGeminiResponse(text)` — Strips markdown code blocks from Gemini output
- `isValidProvider(provider)` / `isValidAmount(amount)` / `isValidConfidence(confidence)`
- `normalizeConfidence(value)` / `normalizeDate(date)` / `normalizeStringField(value)`
- `isSupportedImageType(mimeType)` / `isValidFileSize(bytes)`
- `SUPPORTED_IMAGE_TYPES` / `MAX_SCREENSHOT_SIZE_BYTES` constants

### 3. Types

| Source | Target | Adaptation |
|--------|--------|------------|
| `packages/shared/src/types.ts` (29 lines) | `src/types.ts` | **VERBATIM** |

Zod schemas: `ProviderSchema`, `CategorySchema`, `RideSourceSchema`, `ExtractedRideSchema`, `ExtractedRideErrorSchema`, `ExtractionResultSchema` and their inferred TypeScript types.

Only dependency: `zod` (added to plugin's `package.json`).

### 4. Constants

| Source | Target | Adaptation |
|--------|--------|------------|
| `packages/shared/src/constants.ts` (24 lines) | `src/constants.ts` | **VERBATIM** |

Provider config map (`PROVIDERS`), `CURRENCY`, `DEFAULT_ALERT_THRESHOLD`, `SYNC_INTERVAL_MS`.

### 5. Gmail API Helpers

| Source | Target | Adaptation |
|--------|--------|------------|
| `packages/convex/convex/emailSync.ts` lines 1-251 | `src/gmail/api.ts` | **MINIMAL** |

Extract these items from the original file:

```
Lines 5-6:   Constants (GOOGLE_TOKEN_URL, GMAIL_API_BASE)
Lines 8-12:  PROVIDER_EMAILS map
Lines 14-44: TypeScript interfaces (GmailMessage, GmailMessageDetail, ExtractedRide)
Lines 137-162: refreshGmailToken() — pure fetch, no framework deps
Lines 164-189: fetchGmailMessages() — pure fetch
Lines 191-204: fetchMessageDetail() — pure fetch
Lines 206-209: decodeBase64Url() — pure string manipulation
Lines 211-251: extractEmailBody() — pure data extraction from GmailMessageDetail
```

**Change:** Only remove the Convex-specific imports (`import { v } from "convex/values"` etc.) from the top. All functions are framework-agnostic.

---

## Adapted Code (MODERATE / SUBSTANTIAL)

### 6. OAuth Flow

| Source | Target | Adaptation |
|--------|--------|------------|
| `apps/web/src/app/api/gmail/route.ts` (27 lines) | `src/routes/oauth.ts` (handleGmailAuth) | **MODERATE** |
| `apps/web/src/app/api/gmail/callback/route.ts` (78 lines) | `src/routes/oauth.ts` (handleGmailCallback) | **MODERATE** |

**What changes:**
- Remove Next.js `NextRequest`/`NextResponse` wrappers → use Node.js `IncomingMessage`/`ServerResponse`
- Remove Clerk auth (`const { userId } = await auth()`) → not needed (single user)
- Remove Convex client calls (`convex.query`, `convex.mutation`) → direct libSQL `INSERT`/`UPDATE`
- Remove base64-encoded `state` with `clerkId` → no state needed (single user), or use a simple CSRF nonce
- Config from `process.env.GOOGLE_CLIENT_ID` → from `pluginConfig.googleClientId`
- Redirect from `/onboarding?gmail_connected=true` → return HTML success page

**What stays:**
- Google OAuth2 URL construction (identical parameters)
- Token exchange `fetch("https://oauth2.googleapis.com/token", {...})` (identical)
- Token storage fields: `access_token`, `refresh_token`, `expires_at` computation

### 7. Sync Orchestration

| Source | Target | Adaptation |
|--------|--------|------------|
| `packages/convex/convex/emailSync.ts` lines 589-720 | `src/gmail/sync.ts` | **SUBSTANTIAL** |

**What changes:**
- Remove `userId` parameter and all user-scoping logic
- `ctx.runQuery(internal.emailSync.getUserForSync)` → `db.execute("SELECT * FROM sync_state WHERE id = 1")`
- `ctx.runMutation(internal.emailSync.updateGmailTokens)` → `db.execute("UPDATE sync_state SET ... WHERE id = 1")`
- `ctx.runMutation(internal.emailSync.createRideFromEmail)` → `db.execute("INSERT OR IGNORE INTO rides ...")`
- `ctx.runMutation(internal.emailSync.updateLastEmailSync)` → `db.execute("UPDATE sync_state SET last_sync_at = ?")`
- `ctx.runMutation(internal.emailSync.createSyncLog)` → `db.execute("INSERT INTO sync_logs ...")`
- `user.settings.defaultCategory` → `pluginConfig.defaultCategory`
- `user.settings.emailSyncEnabled` → `sync_state.email_sync_enabled`
- `user.gmailTokens.{accessToken,refreshToken,expiresAt}` → `sync_state.gmail_{access_token,refresh_token,token_expires_at}`

**What stays:**
- Token refresh check (5-minute buffer) — identical logic
- Provider loop (`for (const provider of providersToSync)`) — identical
- Per-message processing: fetchMessageDetail → extractEmailBody → parse{Provider}Receipt — identical
- Error accumulation pattern — identical
- Return shape `{ success, ridesCreated/rides_created, errors }` — identical

### 8. Screenshot Processing

| Source | Target | Adaptation |
|--------|--------|------------|
| `packages/convex/convex/screenshots.ts` lines 38-126 | `src/tools/screenshot.ts` | **MODERATE** |

**What changes:**
- Remove Convex `action` wrapper
- `process.env.GOOGLE_AI_API_KEY` → from `pluginConfig.googleAiApiKey`
- Remove `ctx.storage.get(screenshotId)` → fetch image from URL provided by OpenClaw message attachment
- Remove `ctx.storage.delete()` cleanup → no storage to clean up
- Remove two-step process (processScreenshot + confirmScreenshotRide) → single tool returns extracted data, agent calls `log_ride` to confirm

**What stays:**
- Gemini 2.0 Flash model initialization — identical
- Extraction prompt text — identical (lines 60-73)
- Response parsing: JSON extraction, markdown stripping, validation — identical
- Confidence normalization — identical

---

## New Code (No Original Equivalent)

| Target | Lines (est.) | Purpose |
|--------|-------------|---------|
| `src/index.ts` | ~80 | Plugin definition and registration. No equivalent in original (original uses Convex + Next.js entry points). |
| `src/db/client.ts` | ~40 | libSQL client initialization. Original used Convex's built-in database. |
| `src/db/schema.ts` | ~80 | SQL DDL. Original used Convex's `defineSchema()` declarative schema (68 lines in `schema.ts`). Logic is equivalent but syntax is entirely different. |
| `src/tools/rides.ts` | ~250 | AI tool definitions. Original's `rides.ts` (131 lines) had Convex queries/mutations. Same business logic but wrapped as OpenClaw tool definitions with JSON Schema parameters. |
| `src/tools/budget.ts` | ~100 | AI tool definitions. Original's `budgets.ts` (56 lines) was Convex. Same logic, different wrapper. |
| `src/tools/sync.ts` | ~40 | Thin tool wrapper. Original exposed sync as Convex action. |
| `src/commands/index.ts` | ~120 | No equivalent. Original had a React UI dashboard. Commands replace the dashboard for chat-based interaction. |
| `src/services/emailSync.ts` | ~60 | Service wrapper. Original used Convex `crons.ts` (9 lines). Same purpose (periodic sync), different mechanism (`setInterval` vs Convex cron). |

---

## Summary

| Category | Files | Lines (est.) | % of Total |
|----------|-------|-------------|------------|
| VERBATIM copy | 4 files | ~530 | 31% |
| MINIMAL adaptation | 2 files | ~290 | 17% |
| MODERATE adaptation | 2 files | ~180 | 11% |
| SUBSTANTIAL adaptation | 1 file | ~120 | 7% |
| NEW code | 7 files | ~580 | 34% |
| **Total** | **16 files** | **~1,700** | **100%** |

About 48% of the codebase is directly copied or minimally adapted from the original project. The "new" code is largely framework boilerplate (tool definitions, SQL DDL, plugin registration) rather than novel business logic.
