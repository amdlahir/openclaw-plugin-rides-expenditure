# Architecture Overview

## Purpose

Package the core ride-hailing expenditure tracking features from `@rides-expenditure-tracker/` as an OpenClaw plugin. This allows any OpenClaw installer to track Grab, Gojek, and Tada ride expenses through their messaging channels (WhatsApp, Telegram, Slack, etc.) using their own Gmail account.

## Constraints

- **Single-user**: No multi-tenancy. The plugin serves the OpenClaw installer directly.
- **Local persistence**: `@libsql/client` with a local SQLite file.
- **Currency**: All amounts normalized to SGD cents (matching original app behavior).
- **Providers**: Grab, Gojek, Tada only.
- **Location**: `/home/amin/projects/openclaw-plugin-rides-expenditure/` (linked into OpenClaw via `openclaw plugins install -l`)

## System Context

```
                      +------------------+
                      |   User Device    |
                      | (WhatsApp/TG/etc)|
                      +--------+---------+
                               |
                               v
                      +------------------+
                      |    OpenClaw      |
                      |    Gateway       |
                      +--------+---------+
                               |
                 +-------------+-------------+
                 |                           |
        +--------v---------+       +--------v---------+
        |   AI Agent       |       |   HTTP Server    |
        | (tool calls)     |       |                  |
        +--------+---------+       +--------+---------+
                 |                           |
                 v                           v
        +------------------+       +------------------+
        | rides-expenditure|       | OAuth Routes     |
        | plugin           |       | /rides/gmail/*   |
        +--------+---------+       +--------+---------+
                 |                           |
        +--------v---------+       +--------v---------+
        |   libSQL DB      |       |   Gmail API      |
        | rides.db         |       |                  |
        +------------------+       +------------------+
```

## Plugin Integration Points

The plugin registers into OpenClaw via five extension surfaces:

| Surface | Method | Count | Purpose |
|---------|--------|-------|---------|
| AI Tools | `api.registerTool()` | 10 | LLM-callable functions for ride management |
| Commands | `api.registerCommand()` | 3 | Direct `/slash` commands bypassing LLM |
| HTTP Routes | `api.registerHttpRoute()` | 2 | Gmail OAuth2 flow |
| Services | `api.registerService()` | 1 | Background email sync |
| Skills | `openclaw.plugin.json` | 1 | SKILL.md teaches agent about ride tracking tools |

## Data Flow

### Email Sync Flow

```
Background Service (setInterval)
  |
  +-> Read sync_state (tokens, last_sync_at)
  |
  +-> For each provider (grab, gojek, tada):
  |     |
  |     +-> Gmail API: list messages from:{provider_email} after:{last_sync}
  |     |
  |     +-> For each message:
  |           |
  |           +-> Gmail API: get message detail
  |           +-> extractEmailBody() (base64 decode, multipart handling)
  |           +-> parseGrab/Gojek/TadaReceipt() (regex extraction)
  |           +-> INSERT OR IGNORE into rides (dedup via raw_email_id UNIQUE)
  |
  +-> Update sync_state.last_sync_at
  +-> INSERT sync_logs row
```

### Screenshot OCR Flow

```
User sends image via messaging channel
  |
  +-> AI agent receives image attachment
  +-> Calls parse_receipt_screenshot tool
  |     |
  |     +-> Fetch image from URL
  |     +-> Send to Gemini 2.0 Flash with extraction prompt
  |     +-> Validate/normalize response
  |     +-> Return extracted data to agent
  |
  +-> Agent presents data to user for confirmation
  +-> User confirms -> Agent calls log_ride with extracted data
```

### Manual Logging Flow

```
User: "I took a Grab ride for $15.50 from Orchard to Tanjong Pagar"
  |
  +-> AI agent extracts intent, calls log_ride tool
  +-> INSERT into rides table with source='manual'
  +-> Agent confirms to user
```

## Technology Mapping

| Original (rides-expenditure-tracker) | Plugin Equivalent |
|--------------------------------------|-------------------|
| Convex serverless backend | OpenClaw plugin services + tools |
| Convex database + indexes | libSQL/SQLite + SQL indexes |
| Convex `ctx.runMutation` / `ctx.runQuery` | Direct libSQL SQL queries |
| Clerk auth | Not needed (single-user) |
| Next.js API routes (OAuth) | OpenClaw HTTP routes |
| Convex cron jobs | `setInterval` in registered service |
| React frontend | Chat-based interaction via AI tools + commands |
| Convex file storage (screenshots) | In-memory processing (no storage needed) |

## Module Dependency Graph

```
src/index.ts (entry)
  |
  +-- src/db/client.ts (libSQL singleton)
  |     +-- src/db/schema.ts (DDL + migrations)
  |
  +-- src/tools/rides.ts
  |     +-- src/db/client.ts
  |     +-- src/types.ts
  |
  +-- src/tools/budget.ts
  |     +-- src/db/client.ts
  |
  +-- src/tools/sync.ts
  |     +-- src/gmail/sync.ts
  |           +-- src/gmail/api.ts
  |           +-- src/parsers/emailParser.ts
  |           +-- src/db/client.ts
  |
  +-- src/tools/screenshot.ts
  |     +-- src/parsers/screenshotParser.ts
  |     +-- src/types.ts
  |
  +-- src/commands/index.ts
  |     +-- src/db/client.ts
  |
  +-- src/routes/oauth.ts
  |     +-- src/db/client.ts
  |
  +-- src/services/emailSync.ts
  |     +-- src/gmail/sync.ts
  |     +-- src/db/client.ts
  |
  +-- src/types.ts (Zod schemas)
  +-- src/constants.ts (provider config)

skills/rides-tracking/SKILL.md  (loaded by OpenClaw, not imported by code)
```
