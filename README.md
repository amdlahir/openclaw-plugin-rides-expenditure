# OpenClaw Rides Plugin

An OpenClaw plugin for tracking ride-hailing expenses from Grab and Gojek. Log rides manually via chat, sync receipt emails from Gmail, or extract data from receipt screenshots using Gemini Vision.

> **Security Notice -- Gmail Integration**
>
> This plugin requests **read-only access to your Gmail account** (`gmail.readonly` scope) to fetch ride receipt emails. While the plugin only searches for emails from specific providers (Grab, Gojek), the OAuth token grants read access to **all emails** in your account.
>
> **What this means:**
> - The plugin itself only reads emails matching `from:no-reply@grab.com` or `from:receipts@gojek.com` with "receipt" in the subject
> - However, the OAuth token stored in `~/.openclaw/rides/rides.db` could theoretically be used to read any email
> - The token is stored in plaintext in a local SQLite file on your machine
> - Anyone with access to your machine (or the DB file) could use the token to read your emails
>
> **Recommendations:**
> - Only use this plugin on a machine you trust and control
> - Do not share the `rides.db` file with anyone
> - Periodically review connected apps in your [Google Account Security settings](https://myaccount.google.com/permissions) and revoke access if you stop using the plugin
> - If your machine is compromised, revoke the app's access immediately from Google Account settings
>
> Gmail sync is entirely optional. The plugin works fully without it -- you can log rides manually or via screenshots.

## Features

- **Manual ride logging** via natural language ("I took a Grab for $15 from Orchard to Bugis")
- **Gmail email sync** -- automatically parse Grab and Gojek receipt emails
- **Screenshot parsing** -- extract ride data from receipt images using Gemini 2.0 Flash
- **Multi-currency** -- SGD, USD, MYR with automatic exchange rate normalization (Frankfurter API)
- **Budget tracking** -- set monthly limits with configurable currency and alert thresholds
- **Spending stats** -- breakdown by provider, category, or month
- **Slash commands** -- `/rides`, `/rides_stats`, `/rides_sync` for quick access without AI
- **Agent skill** -- the AI agent knows about ride tracking tools automatically

## Requirements

- [OpenClaw](https://openclaw.dev) installed and running
- Node.js 18+
- A Google Cloud project (for Gmail sync and optional screenshot parsing)

## Installation

### 1. Clone and install dependencies

```bash
git clone https://github.com/amdlahir/openclaw-plugin-rides-expenditure.git
cd openclaw-plugin-rides-expenditure
npm install
```

### 2. Register the plugin with OpenClaw

Add the plugin path and configuration to `~/.openclaw/openclaw.json`:

```json
{
  "plugins": {
    "allow": ["rides"],
    "load": {
      "paths": ["/path/to/openclaw-plugin-rides-expenditure"]
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
- Or say "Sync my ride emails" -- the AI agent will call the sync tool

## Setting Up Screenshot Parsing (Optional)

Screenshot parsing uses Google's Gemini 2.0 Flash to extract ride data from receipt images.

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

### Currency

Rides are stored in their original currency and normalized to your budget currency for aggregation. Supported currencies: **SGD**, **USD**, **MYR**.

- Specify currency when logging: "I took a Grab for RM15 from KLCC"
- Change budget currency: "Set my budget to 2000 MYR" -- this recomputes all historical normalized amounts
- Exchange rates fetched from [Frankfurter API](https://frankfurter.dev), cached for 24 hours
- If the rate API is unavailable, rides are stored with a null normalized amount and backfilled later

## Data Storage

The database is stored at `~/.openclaw/rides/rides.db` (SQLite via libSQL). It persists independently of the plugin source code.

**Tables:**
- `rides` -- individual ride records (original + normalized amounts)
- `budgets` -- monthly spending limit configuration
- `sync_state` -- Gmail OAuth tokens and sync cursor (singleton row)
- `sync_logs` -- audit trail for email sync operations
- `exchange_rates` -- cached currency conversion rates

## Project Structure

```
openclaw-plugin-rides-expenditure/
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
      emailParser.ts            # Grab + Gojek receipt email parsers
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
      index.ts                  # /rides, /rides_stats, /rides_sync
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
    emailParser.test.ts         # Email parser tests (16 tests)
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

Tests use real in-memory SQLite databases (not mocks). 78 tests across 6 files.

### Making Changes

1. Edit source files in `src/`
2. Run tests: `npm test`
3. Restart the gateway to pick up changes: `openclaw gateway stop && openclaw gateway`

No build step -- OpenClaw loads TypeScript directly via jiti.

### Adding a New Provider

1. Add the provider to `ProviderSchema` in `src/types.ts`
2. Add the provider email to `PROVIDERS` in `src/constants.ts` and `PROVIDER_EMAILS` in `src/gmail/api.ts`
3. Add a parser function in `src/parsers/emailParser.ts`
4. Register the parser in the `PARSERS` map in `src/gmail/sync.ts`
5. Update tool parameter enums in `src/index.ts`
6. Add tests in `tests/emailParser.test.ts`

### Adding a New Currency

1. Add to `CurrencySchema` in `src/types.ts`
2. Add to `SUPPORTED_CURRENCIES` in `src/constants.ts`
3. Update tool parameter enums in `src/index.ts`
4. The Frankfurter API supports most world currencies -- no API changes needed

## Troubleshooting

### Plugin not loading

Check the gateway output for errors. Common issues:
- Missing required config fields (`googleClientId`, `googleClientSecret`, `baseUrl`)
- Plugin entry key in `openclaw.json` must be `"rides"` (matching the `id` in `openclaw.plugin.json`)
- Dependencies not installed (`npm install` in the plugin directory)

### OAuth redirect_uri_mismatch

The redirect URI in Google Cloud Console must exactly match `{baseUrl}/rides/gmail/callback`. If your baseUrl is `http://localhost:18789`, the redirect URI must be `http://localhost:18789/rides/gmail/callback`.

### OAuth on a remote server

If OpenClaw runs on a remote server, the gateway binds to loopback by default. Set up an SSH tunnel from your local machine:

```bash
ssh -L 18789:localhost:18789 user@your-server
```

Then open `http://localhost:18789/rides/gmail/auth` in your local browser. Google OAuth works with `http://localhost` (no HTTPS required).

### Email sync finds no rides

- Check that Gmail is connected: tokens should be in `sync_state` table
- Grab emails come from `no-reply@grab.com`, Gojek from `receipts@gojek.com`
- The sync searches for emails with "receipt" in the subject
- Check `sync_logs` table for error details

### Pickup/dropoff locations are empty

Grab emails use HTML with locations in a specific table layout. The parser strips HTML and looks for the "Your Trip" section with address + time pairs. Location extraction may fail for unusual email formats -- amounts are always extracted correctly.

## License

[MIT](LICENSE)
