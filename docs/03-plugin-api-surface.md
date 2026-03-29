# Plugin API Surface

## Plugin Manifest

File: `openclaw.plugin.json`

```json
{
  "id": "rides-expenditure",
  "skills": ["./skills"],
  "configSchema": {
    "type": "object",
    "additionalProperties": false,
    "properties": {
      "googleClientId": {
        "type": "string",
        "description": "Google OAuth2 Client ID for Gmail API access"
      },
      "googleClientSecret": {
        "type": "string",
        "description": "Google OAuth2 Client Secret"
      },
      "googleAiApiKey": {
        "type": "string",
        "description": "Google AI API key for Gemini 2.0 Flash. Optional — enables screenshot parsing."
      },
      "baseUrl": {
        "type": "string",
        "description": "Public URL of the OpenClaw instance (for OAuth redirect URI)"
      },
      "defaultCurrency": {
        "type": "string",
        "default": "SGD"
      },
      "defaultCategory": {
        "type": "string",
        "default": "personal",
        "enum": ["work", "personal"]
      },
      "syncIntervalMinutes": {
        "type": "number",
        "default": 15
      }
    },
    "required": ["googleClientId", "googleClientSecret", "baseUrl"]
  }
}
```

## Configuration

Users configure the plugin in `~/.openclaw/openclaw.json`:

```json
{
  "plugins": {
    "entries": {
      "rides-expenditure": {
        "enabled": true,
        "config": {
          "googleClientId": "xxx.apps.googleusercontent.com",
          "googleClientSecret": "GOCSPX-xxx",
          "googleAiApiKey": "AIzaSy-xxx",
          "baseUrl": "https://my-openclaw.example.com",
          "defaultCategory": "personal",
          "syncIntervalMinutes": 15
        }
      }
    }
  }
}
```

---

## AI Tools (10)

Tools are registered via `api.registerTool()` and are callable by the LLM agent during conversations.

### Ride Management

#### `log_ride`

Manually record a ride.

```
Parameters:
  provider:   string (required) — "grab" | "gojek" | "tada"
  amount:     number (required) — Amount in dollars (e.g., 15.50). Converted to cents internally.
  date:       string (optional) — ISO 8601 date. Defaults to now.
  pickup:     string (optional) — Pickup location
  dropoff:    string (optional) — Dropoff location
  category:   string (optional) — "work" | "personal". Defaults to plugin config defaultCategory.

Returns:
  { id: number, message: string }
```

**SQL:** `INSERT INTO rides (...) VALUES (...)`

#### `list_rides`

List recent rides with optional filters.

```
Parameters:
  limit:      number (optional, default 10, max 50)
  provider:   string (optional) — Filter by provider
  category:   string (optional) — Filter by category
  start_date: string (optional) — ISO 8601 start date
  end_date:   string (optional) — ISO 8601 end date

Returns:
  { rides: Array<{ id, provider, amount, currency, date, pickup, dropoff, category, source, confidence }>, total: number }
```

**SQL:** `SELECT ... FROM rides WHERE ... ORDER BY date DESC LIMIT ?`

#### `ride_spending_stats`

Get spending statistics for a date range.

```
Parameters:
  start_date: string (required) — ISO 8601 start date
  end_date:   string (required) — ISO 8601 end date
  group_by:   string (optional) — "provider" | "category" | "month". Default: "provider"

Returns:
  {
    total_amount: number,      // cents
    total_rides: number,
    breakdown: Array<{ group: string, amount: number, count: number }>,
    currency: "SGD"
  }
```

**SQL:** `SELECT {group_col}, SUM(amount), COUNT(*) FROM rides WHERE date BETWEEN ? AND ? GROUP BY {group_col}`

#### `search_rides`

Search rides by pickup/dropoff location text.

```
Parameters:
  query: string (required) — Search term
  limit: number (optional, default 10)

Returns:
  { rides: Array<Ride> }
```

**SQL:** `SELECT ... FROM rides WHERE pickup LIKE ? OR dropoff LIKE ? ORDER BY date DESC LIMIT ?`

#### `update_ride`

Update an existing ride's details. Sets `manually_edited = 1`.

```
Parameters:
  ride_id:  number (required)
  amount:   number (optional) — New amount in dollars
  category: string (optional) — "work" | "personal"
  pickup:   string (optional)
  dropoff:  string (optional)

Returns:
  { success: boolean, message: string }
```

**SQL:** `UPDATE rides SET ..., manually_edited = 1 WHERE id = ?`

#### `delete_ride`

Delete a ride by ID.

```
Parameters:
  ride_id: number (required)

Returns:
  { success: boolean, message: string }
```

**SQL:** `DELETE FROM rides WHERE id = ?`

### Budget Management

#### `set_ride_budget`

Set or update the monthly spending limit.

```
Parameters:
  monthly_limit:   number (required) — Monthly limit in dollars (e.g., 200.00)
  alert_threshold: number (optional, default 0.8) — Alert at this fraction (0.0-1.0)

Returns:
  { success: boolean, monthly_limit: number, alert_threshold: number }
```

**SQL:** `DELETE FROM budgets; INSERT INTO budgets (...) VALUES (...)`

#### `get_budget_status`

Get current month's spending relative to budget.

```
Parameters: (none)

Returns:
  {
    has_budget: boolean,
    monthly_limit: number | null,     // cents
    total_spent: number,              // cents for current month
    remaining: number | null,         // cents
    percentage_used: number | null,   // 0.0-1.0
    threshold_exceeded: boolean,
    alert_threshold: number | null,
    ride_count: number,
    currency: "SGD"
  }
```

**SQL:** Joins budget query with current month ride aggregation.

### Email Sync

#### `sync_ride_emails`

Trigger an immediate Gmail sync (outside the background schedule).

```
Parameters:
  provider: string (optional) — Sync only this provider. Omit for all.

Returns:
  {
    success: boolean,
    emails_processed: number,
    rides_created: number,
    errors: string[]
  }
```

Uses the same sync logic as the background service but runs on-demand.

### Screenshot Parsing

#### `parse_receipt_screenshot`

Extract ride data from a receipt screenshot using Gemini 2.0 Flash.

```
Parameters:
  image_url: string (required) — URL of the receipt image (from message attachment)

Returns:
  On success:
  {
    provider: string,
    amount: number,        // dollars
    date: string | null,
    pickup: string | null,
    dropoff: string | null,
    confidence: number
  }

  On failure:
  { error: "not_a_receipt" | "screenshot_parsing_disabled" | string }
```

**Behavior:**
- If `googleAiApiKey` is not configured, returns `{ error: "screenshot_parsing_disabled" }`.
- Fetches the image from `image_url`, sends to Gemini 2.0 Flash.
- Returns extracted data for the agent to present to the user.
- The agent should then call `log_ride` with the confirmed data.

**Note:** This is a single-step tool (unlike the original app's two-step process). The agent handles the confirmation dialog naturally in conversation.

---

## Commands (3)

Commands are registered via `api.registerCommand()` and execute directly without invoking the LLM. Users type these as `/command` in any channel.

### `/rides`

Show recent rides in a formatted table.

```
Output format:
  Recent Rides (last 10):
  ┌────┬──────────┬────────┬────────────┬───────────────────────┐
  │ ID │ Provider │ Amount │    Date    │       Route           │
  ├────┼──────────┼────────┼────────────┼───────────────────────┤
  │ 42 │ Grab     │ $15.50 │ 2026-03-28 │ Orchard → Tanjong ... │
  │ 41 │ Gojek    │  $8.00 │ 2026-03-27 │ MBS → Bugis           │
  └────┴──────────┴────────┴────────────┴───────────────────────┘
```

**SQL:** `SELECT * FROM rides ORDER BY date DESC LIMIT 10`

### `/rides-stats`

Show current month spending summary.

```
Output format:
  March 2026 Spending Summary
  ───────────────────────────
  Total: $245.50 (18 rides)

  By Provider:
    Grab:  $150.00 (10 rides)
    Gojek:  $65.50 (5 rides)
    Tada:   $30.00 (3 rides)

  By Category:
    Personal: $180.00 (13 rides)
    Work:      $65.50 (5 rides)

  Budget: $245.50 / $500.00 (49.1%) ✓
```

**SQL:** Aggregation queries on rides for current month + budget lookup.

### `/rides-sync`

Trigger email sync and report results.

```
Output format:
  Email Sync Results
  ──────────────────
  Emails processed: 12
  Rides created: 3
  Errors: none

  Last sync: 2026-03-28 14:30:00
```

Calls the same sync logic as the `sync_ride_emails` tool.

---

## HTTP Routes (2)

Routes are registered via `api.registerHttpRoute()` using Node.js `IncomingMessage`/`ServerResponse`.

### `GET /rides/gmail/auth`

Initiates Gmail OAuth2 flow.

```
Auth:    "plugin"
Match:   "exact"

Behavior:
  1. Build Google OAuth2 authorization URL:
     - client_id from pluginConfig.googleClientId
     - redirect_uri = {pluginConfig.baseUrl}/rides/gmail/callback
     - scope = https://www.googleapis.com/auth/gmail.readonly
     - access_type = offline
     - prompt = consent
  2. Respond with 302 redirect to Google consent screen

Response: 302 Redirect
```

### `GET /rides/gmail/callback`

Handles OAuth2 callback from Google.

```
Auth:    "plugin"
Match:   "exact"

Behavior:
  1. Extract `code` from query params
  2. Exchange code for tokens via POST to https://oauth2.googleapis.com/token
  3. Store access_token, refresh_token, expires_at in sync_state table
  4. Set email_sync_enabled = 1
  5. Return HTML success page

Response: 200 HTML (success or error message)
```

---

## Service (1)

### `rides-email-sync`

Background service registered via `api.registerService()`.

```
start(ctx: OpenClawPluginServiceContext):
  1. Read sync_state to check if email_sync_enabled and tokens exist
  2. If enabled, run immediate sync
  3. Schedule recurring sync via setInterval (pluginConfig.syncIntervalMinutes)

stop(ctx: OpenClawPluginServiceContext):
  1. Clear the interval timer
```

Each sync cycle:
1. Check token expiry (5-minute buffer). Refresh if needed.
2. For each provider: fetch Gmail messages, parse receipts, insert rides.
3. Update `sync_state.last_sync_at`.
4. Insert `sync_logs` row.

---

## Skill (1)

### `rides-tracking`

Declared in `openclaw.plugin.json` via the `skills` field. OpenClaw loads the `SKILL.md` file and injects it into the agent's context so it knows when and how to use the ride tracking tools.

**Manifest entry:**
```json
{
  "id": "rides-expenditure",
  "skills": ["./skills"],
  ...
}
```

**Skill file:** `skills/rides-tracking/SKILL.md`

Uses YAML frontmatter (`name`, `description`) and a markdown body that describes:
- When to use ride tracking tools
- Available tools and what each does
- Example conversational flows
- Supported providers (Grab, Gojek, Tada)

This replaces a `before_prompt_build` hook — skills are the idiomatic OpenClaw way to teach the agent about plugin capabilities.
