# OpenClaw Rides Plugin

An OpenClaw plugin for tracking ride-hailing expenses from Grab, Gojek, and Zig (CDG). Log rides manually via chat, sync receipt emails from Gmail, or extract data from receipt screenshots using Gemini Vision.

> **Security Notice -- Gmail Integration**
>
> This plugin requests **read-only access to your Gmail account** (`gmail.readonly` scope) to fetch ride receipt emails. While the plugin only searches for emails from specific providers (Grab, Gojek, Zig), the OAuth token grants read access to **all emails** in your account.
>
> **What this means:**
> - The plugin itself only reads emails matching specific provider sender addresses with ride-related subjects
> - However, the OAuth token stored in `~/.openclaw/rides/tokens.json` could theoretically be used to read any email
> - The token is stored in plaintext in a local file on your machine (with restricted `0o600` permissions)
> - Anyone with access to your machine (or the token file) could use the token to read your emails
>
> **Token storage details:**
> - OAuth tokens are stored in a **separate file** (`~/.openclaw/rides/tokens.json`), not in the rides database -- this means `rides.db` is safe to back up without exposing credentials
> - Both the token file and database are created with restricted permissions (`0o600` / `0o700`) automatically
> - The refresh token **never expires** unless you explicitly revoke it -- a single leak grants persistent Gmail read access
> - If `~/.openclaw/rides/tokens.json` is included in cloud backups, file syncing, or rsync to shared servers, the token travels with it
> - OpenClaw does not currently provide a plugin-level secure storage API, so encryption at rest is not available through the framework
>
> **Recommendations:**
> - Only use this plugin on a machine you trust and control
> - Do not share `tokens.json` with anyone (`rides.db` is safe to share -- it contains no credentials)
> - Exclude `~/.openclaw/rides/tokens.json` from cloud backup and file sync services
> - Periodically review connected apps in your [Google Account Security settings](https://myaccount.google.com/permissions) and revoke access if you stop using the plugin
> - If your machine is compromised, run `/rides_disconnect` to delete local tokens, then revoke the app's access from [Google Account settings](https://myaccount.google.com/permissions)
>
> Gmail sync is entirely optional. The plugin works fully without it -- you can log rides manually or via screenshots.

## Important Notes

- **Email parsing does not use an LLM.** Receipt emails are parsed using hand-written regex parsers, not AI. This means parsing is fast, free, and deterministic -- but also means each provider's email format must be explicitly supported. If a provider changes their email HTML structure, the parser will need updating.
- **Updating parsers when email formats change.** If email sync stops extracting data correctly, save a sample of the new email HTML (Gmail > 3-dot menu > "Show original") and provide it to your coding assistant. They can update the parser regex patterns and unit tests to match the new format.
- **Singapore context only.** The plugin has only been tested with Singapore ride-hailing receipts (SGD). Gojek Indonesia (IDR), Grab Malaysia (MYR), and other regional formats may not parse correctly. MYR Grab parsing is a skeleton implementation awaiting real email samples.
- **Screenshot parsing is experimental.** Receipt screenshot extraction via Gemini Vision is functional but still a work in progress. Always confirm extracted data before logging.
- **Restart sessions after plugin changes.** If you make changes to the plugin source on your environment, restart the OpenClaw gateway and run `/new` in your chat to start a fresh session so the agent picks up updated tool definitions.

## Features

- **Manual ride logging** via natural language ("I took a Grab for $15 from Orchard to Bugis")
- **Gmail email sync** -- automatically parse Grab, Gojek, and Zig receipt emails
- **Screenshot parsing** -- extract ride data from receipt images using Gemini 2.0 Flash (experimental)
- **Multi-currency** -- SGD, USD, MYR with automatic exchange rate normalization (Frankfurter API)
- **Budget tracking** -- set monthly limits with configurable currency and alert thresholds
- **Spending stats** -- breakdown by provider, category, or month
- **Slash commands** -- `/rides`, `/rides_stats`, `/rides_sync`, `/rides_reset` for quick access without AI
- **Agent skill** -- the AI agent knows about ride tracking tools automatically

## Supported Providers

| Provider | Sender Email | Subject Pattern | Notes |
|----------|-------------|-----------------|-------|
| Grab | `no-reply@grab.com` | "receipt" | SGD and MYR (MYR is skeleton) |
| Gojek | `no-reply@invoicing.gojek.com` | "trip" or "receipt" | SGD only |
| Zig (CDG) | `noreply@cdgtaxi.com.sg` | "ride" or "receipt" | SGD only, ComfortDelGro taxis |

## Requirements

- [OpenClaw](https://openclaw.dev) installed and running
- Node.js 18+
- A Google Cloud project (for Gmail sync and optional screenshot parsing)

## Installation

### 1. Clone and install dependencies

```bash
git clone https://github.com/amdlahir/openclaw-plugin-rides.git
cd openclaw-plugin-rides
npm install
```

### 2. Register the plugin with OpenClaw

Add the plugin path and configuration to `~/.openclaw/openclaw.json`:

```json
{
  "plugins": {
    "allow": ["rides"],
    "load": {
      "paths": ["/path/to/openclaw-plugin-rides"]
    },
    "entries": {
      "rides": {
        "enabled": true,
        "config": {
          "googleClientId": "YOUR_CLIENT_ID.apps.googleusercontent.com",
          "googleClientSecret": "YOUR_CLIENT_SECRET",
          "baseUrl": "http://localhost:18789",
          "defaultCurrency": "SGD",
          "defaultCategory": "personal"
        }
      }
    }
  }
}
```

The `allow` array is required for OpenClaw to expose the plugin's AI tools to the agent. Without it, slash commands work but the agent cannot call tools like `log_ride` or `sync_ride_emails`.

**Tool policy:** If your `tools` config uses `profile` (e.g., `"messaging"`), plugin tools are not included by default. Add them via `alsoAllow`:

```json
{
  "tools": {
    "profile": "messaging",
    "alsoAllow": ["log_ride", "list_rides", "ride_spending_stats", "search_rides", "update_ride", "delete_ride", "set_ride_budget", "get_budget_status", "sync_ride_emails", "parse_receipt_screenshot"]
  }
}
```

Merge this into your existing config -- don't replace the whole file. Keep your existing `plugins.entries` (telegram, whatsapp, etc.) and add the `rides` entry alongside them.

### 3. Restart OpenClaw

```bash
openclaw gateway stop && openclaw gateway
```

The plugin loads TypeScript directly via jiti -- no build step needed. You should see:

```
[plugins] Initializing rides plugin, DB at: ...
[plugins] Database migrations complete
```

## Configuration

| Key | Required | Default | Description |
|-----|----------|---------|-------------|
| `googleClientId` | Yes | -- | Google OAuth2 Client ID |
| `googleClientSecret` | Yes | -- | Google OAuth2 Client Secret |
| `baseUrl` | Yes | -- | URL of your OpenClaw instance (for OAuth redirect) |
| `googleAiApiKey` | No | -- | Google AI API key for Gemini 2.0 Flash (enables screenshot parsing) |
| `defaultCurrency` | No | `SGD` | Default currency for rides and budgets (`SGD`, `USD`, `MYR`) |
| `defaultCategory` | No | `personal` | Default category for rides (`work`, `personal`) |

## Setting Up Google Cloud (Gmail Sync)

Gmail sync requires a Google Cloud OAuth2 client. Follow these steps:

### 1. Create a Google Cloud project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project (or use an existing one)
3. Give it a name (e.g., "OpenClaw Rides")

### 2. Enable the Gmail API

1. Go to **APIs & Services** > **Library**
2. Search for "Gmail API"
3. Click **Enable**

### 3. Configure the OAuth consent screen

1. Go to **APIs & Services** > **OAuth consent screen**
2. Select **External** user type (or Internal if using Google Workspace)
3. Fill in the required fields:
   - App name: "OpenClaw Rides" (or anything you like)
   - User support email: your email
   - Developer contact: your email
4. On the **Scopes** step, add: `https://www.googleapis.com/auth/gmail.readonly`
5. On the **Test users** step, add your Gmail address
6. Save and continue

### 4. Create OAuth2 credentials

1. Go to **APIs & Services** > **Credentials**
2. Click **Create Credentials** > **OAuth client ID**
3. Application type: **Web application**
4. Name: "OpenClaw Rides" (or anything)
5. Under **Authorized redirect URIs**, add your callback URL:
   - For localhost: `http://localhost:18789/rides/gmail/callback`
   - For a public server: `https://your-domain.com/rides/gmail/callback`
6. Click **Create**
7. Copy the **Client ID** and **Client Secret**

### 5. Add credentials to plugin config

Update `~/.openclaw/openclaw.json` with your Client ID and Client Secret in the `rides` plugin config (see Installation step 2).

### 6. Connect your Gmail account

1. Make sure OpenClaw gateway is running
2. If your OpenClaw is on a remote server, set up an SSH tunnel:
   ```bash
   ssh -L 18789:localhost:18789 user@your-server
   ```
3. Open your browser and go to: `http://localhost:18789/rides/gmail/auth`
4. Complete the Google consent screen
5. You should see "Gmail Connected" on success

### 7. Sync your emails

In your chat (Telegram, WhatsApp, etc.), use:
- `/rides_sync` -- slash command (instant, no AI)
- `/rides_sync 6` -- sync last 6 months of history
- Or say "Sync my ride emails" -- the AI agent will call the sync tool

## Setting Up Screenshot Parsing (Optional, Experimental)

Screenshot parsing uses Google's Gemini 2.0 Flash to extract ride data from receipt images. This feature is still a work in progress.

1. Go to [Google AI Studio](https://aistudio.google.com/)
2. Create an API key
3. Add it to your plugin config as `googleAiApiKey`
4. Restart the gateway

To use: send a receipt screenshot to the bot. The agent will extract the data and ask you to confirm before logging.

## Usage

### AI Tools (via chat)

Talk to the bot naturally:

| What you say | Tool used |
|---|---|
| "I took a Grab for $15.50 from Orchard to Bugis" | `log_ride` |
| "Show my recent rides" | `list_rides` |
| "How much did I spend this month?" | `ride_spending_stats` |
| "Find rides to the airport" | `search_rides` |
| "Update ride 42 to work category" | `update_ride` |
| "Delete ride 42" | `delete_ride` |
| "Set my ride budget to $500" | `set_ride_budget` |
| "What's my budget status?" | `get_budget_status` |
| "Sync my ride emails" | `sync_ride_emails` |
| "Sync my ride emails for the past 3 months" | `sync_ride_emails` (months=3) |
| *(send a receipt image)* | `parse_receipt_screenshot` |

### Slash Commands (instant, no AI)

| Command | Description |
|---------|-------------|
| `/rides` | Formatted table of last 10 rides |
| `/rides_stats` | Current month spending summary with budget status |
| `/rides_sync` | Trigger Gmail sync (new emails since last sync) |
| `/rides_sync 6` | Sync last 6 months of ride emails |
| `/rides_reset` | Delete all rides and reset sync cursor (cannot be undone) |
| `/rides_disconnect` | Disconnect Gmail and delete stored OAuth tokens (ride data is kept) |

### Currency

Rides are stored in their original currency and normalized to your budget currency for aggregation. Supported currencies: **SGD**, **USD**, **MYR**.

- Specify currency when logging: "I took a Grab for RM15 from KLCC"
- Change budget currency: "Set my budget to 2000 MYR" -- this recomputes all historical normalized amounts
- Exchange rates fetched from [Frankfurter API](https://frankfurter.dev), cached for 24 hours
- If the rate API is unavailable, rides are stored with a null normalized amount and backfilled later

## Data Storage

The database is stored at `~/.openclaw/rides/rides.db` (SQLite via libSQL). OAuth tokens are stored separately in `~/.openclaw/rides/tokens.json`. Both persist independently of the plugin source code.

**Tables:**
- `rides` -- individual ride records (original + normalized amounts)
- `budgets` -- monthly spending limit configuration
- `sync_state` -- sync cursor and email sync enabled flag (singleton row)
- `sync_logs` -- audit trail for email sync operations
- `exchange_rates` -- cached currency conversion rates

## Project Structure

```
openclaw-plugin-rides/
  openclaw.plugin.json          # Plugin manifest
  package.json                  # Dependencies + openclaw.extensions entry
  vitest.config.ts              # Test runner config
  skills/
    rides-tracking/
      SKILL.md                  # Teaches the AI agent about ride tools
  src/
    index.ts                    # Plugin entry point + registration
    types.ts                    # Zod schemas (Provider, Category, Currency)
    constants.ts                # Provider config, defaults
    currency.ts                 # Exchange rate fetching, caching, normalization
    db/
      client.ts                 # libSQL client factory
      schema.ts                 # SQL DDL + migrations
    parsers/
      emailParser.ts            # Grab, Gojek, and Zig receipt email parsers
      screenshotParser.ts       # Gemini response validation + normalization
    gmail/
      api.ts                    # Gmail API helpers (fetch, decode, extract)
      oauth.ts                  # OAuth URL builder + token exchange
      sync.ts                   # Sync orchestration (fetch -> parse -> insert)
    tools/
      rides.ts                  # log, list, search, update, delete handlers
      stats.ts                  # Spending statistics handler
      budget.ts                 # Budget set + status handlers
      sync.ts                   # Email sync tool handler
      screenshot.ts             # Screenshot parsing tool handler
    commands/
      index.ts                  # /rides, /rides_stats, /rides_sync, /rides_reset
    routes/
      oauth.ts                  # HTTP handlers for Gmail OAuth flow
    hooks/
      syncNotifications.ts      # session_start hook for parse failure alerts
    services/
      emailSync.ts              # Background sync service (currently unused)
  tests/
    rides.test.ts               # Ride CRUD tests (18 tests)
    stats.test.ts               # Spending statistics tests (6 tests)
    budget.test.ts              # Budget management tests (7 tests)
    currency.test.ts            # Currency conversion tests (12 tests)
    emailParser.test.ts         # Email parser tests (22 tests)
    screenshotParser.test.ts    # Screenshot parser utility tests (19 tests)
```

## Development

### Prerequisites

```bash
node --version  # 18+
npm install
```

### Running Tests

```bash
npm test              # Run all tests once
npm run test:watch    # Watch mode
```

Tests use real in-memory SQLite databases (not mocks). 84 tests across 6 files.

### Making Changes

1. Edit source files in `src/`
2. Run tests: `npm test`
3. Restart the gateway to pick up changes: `openclaw gateway stop && openclaw gateway`
4. Run `/new` in your chat to start a fresh session with updated tool definitions

No build step -- OpenClaw loads TypeScript directly via jiti.

### Adding a New Provider

1. Add the provider to `ProviderSchema` in `src/types.ts`
2. Add the provider to the CHECK constraint in `src/db/schema.ts` and add a migration in `migrateProviderCheck()` if needed
3. Add the provider email to `PROVIDERS` in `src/constants.ts` and `PROVIDER_EMAILS` + `PROVIDER_SUBJECT_FILTERS` in `src/gmail/api.ts`
4. Add a parser function in `src/parsers/emailParser.ts`
5. Register the parser in the `PARSERS` map in `src/gmail/sync.ts`
6. Update tool parameter enums and descriptions in `src/index.ts`
7. Update `isValidProvider` in `src/parsers/screenshotParser.ts` and the extraction prompt in `src/tools/screenshot.ts`
8. Add tests in `tests/emailParser.test.ts`

### Adding a New Currency

1. Add to `CurrencySchema` in `src/types.ts`
2. Add to `SUPPORTED_CURRENCIES` in `src/constants.ts`
3. Update tool parameter enums in `src/index.ts`
4. The Frankfurter API supports most world currencies -- no API changes needed

### Disconnecting Gmail

Use `/rides_disconnect` to remove your stored OAuth tokens and disable email sync. Your ride data is not affected. Use this when:

- You no longer want Gmail sync and want to clean up stored credentials
- You suspect your machine or token file may have been compromised
- You want to switch to a different Gmail account (disconnect, then re-auth)

`/rides_disconnect` only deletes **local** tokens. The app still appears in your Google account's authorized apps until you also revoke it at [Google Account > Security > Third-party apps](https://myaccount.google.com/permissions). For full cleanup, do both.

To reconnect later, visit `{baseUrl}/rides/gmail/auth` in your browser (see Step 6 under "Setting Up Google Cloud").

## Troubleshooting

### Plugin not loading

Check the gateway output for errors. Common issues:
- Missing required config fields (`googleClientId`, `googleClientSecret`, `baseUrl`)
- Plugin entry key in `openclaw.json` must be `"rides"` (matching the `id` in `openclaw.plugin.json`)
- Dependencies not installed (`npm install` in the plugin directory)

### Natural language works but tools aren't called

The agent needs the plugin's tools in its tool policy. If you use `tools.profile` (e.g., `"messaging"` or `"coding"`), plugin tools are excluded by default. Use `tools.alsoAllow` to add them -- see Installation step 2. Using `tools.allow` instead of `alsoAllow` will **replace** the profile's tools rather than adding to them.

### OAuth redirect_uri_mismatch

The redirect URI in Google Cloud Console must exactly match `{baseUrl}/rides/gmail/callback`. If your baseUrl is `http://localhost:18789`, the redirect URI must be `http://localhost:18789/rides/gmail/callback`.

### OAuth on a remote server

If OpenClaw runs on a remote server, the gateway binds to loopback by default. Set up an SSH tunnel from your local machine:

```bash
ssh -L 18789:localhost:18789 user@your-server
```

Then open `http://localhost:18789/rides/gmail/auth` in your local browser. Google OAuth works with `http://localhost` (no HTTPS required).

### Email sync finds no rides

- Check that Gmail is connected: `~/.openclaw/rides/tokens.json` should exist with valid tokens
- Verify the sender email matches what the provider actually uses (check "Show original" in Gmail for the `From:` header)
- Check `sync_logs` table for error details
- If you recently added a new provider, the database CHECK constraint may need migrating -- restart the gateway to trigger automatic migration

### Pickup/dropoff locations are empty

Location extraction depends on the email HTML structure. Each provider uses a different format:
- **Grab**: locations in a "Your Trip" section with address + time pairs. Extraction may fail for unusual formats.
- **Gojek**: "Picked up on DATE from" / "Arrived on DATE at" pattern.
- **Zig**: "Pick Up / Drop Off Point @" for pickup, standalone Singapore address for dropoff.

Amounts are always extracted correctly even when locations fail.

## License

[MIT](LICENSE)
