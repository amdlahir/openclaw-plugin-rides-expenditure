---
name: rides-tracking
description: Track ride-hailing expenses from Grab and Gojek across SGD, USD, and MYR. Log rides via chat, sync from Gmail, parse receipt screenshots, manage budgets, and view spending stats.
---

# Ride Expense Tracking

You have ride-hailing expense tracking tools available. Use them when the user mentions rides, Grab, Gojek, fares, ride expenses, transportation costs, ride budget, or ride spending.

## Available Tools

| Tool | When to use | Returns |
|------|-------------|---------|
| `log_ride` | User tells you about a ride they took | Ride ID and confirmation message |
| `list_rides` | User wants to see recent rides or ride history | Array of rides with amounts, dates, locations |
| `search_rides` | User asks about rides to/from a specific place | Array of matching rides |
| `ride_spending_stats` | User asks about spending, totals, or breakdowns | Total amount, ride count, and breakdown by provider/category/month |
| `update_ride` | User wants to correct a ride's details | Success/failure message |
| `delete_ride` | User wants to remove a ride | Success/failure message |
| `set_ride_budget` | User wants to set or change their monthly limit | Confirmed budget and threshold |
| `get_budget_status` | User asks about budget, remaining balance, or how much they've spent | Spent, remaining, percentage, threshold status |
| `sync_ride_emails` | User wants to pull ride receipts from Gmail | Count of emails processed and rides created |
| `parse_receipt_screenshot` | User sends a receipt image | Extracted provider, amount, date, locations, and confidence score |

## Supported Providers

- **Grab** -- Singapore, Malaysia
- **Gojek** -- Singapore

## Supported Currencies

SGD, USD, MYR. Amounts are stored in the original currency and normalized to the user's budget currency for aggregation. If no currency is specified, the configured default (usually SGD) is used.

## Example Flows

**Manual logging:**
User: "I took a Grab for $15.50 from Orchard to Bugis"
-> Call `log_ride` with provider=grab, amount=15.50, pickup=Orchard, dropoff=Bugis

**Logging with currency:**
User: "Grab ride RM12 from KLCC to Bukit Bintang"
-> Call `log_ride` with provider=grab, amount=12, currency=MYR, pickup=KLCC, dropoff=Bukit Bintang

**Spending check:**
User: "How much did I spend on rides this month?"
-> Call `ride_spending_stats` with current month start and end dates

**Spending breakdown:**
User: "Break down my ride spending by category for March"
-> Call `ride_spending_stats` with start_date=2026-03-01, end_date=2026-03-31, group_by=category

**Budget setup:**
User: "Set my monthly ride budget to $500"
-> Call `set_ride_budget` with monthly_limit=500

**Budget check:**
User: "Am I over budget?"
-> Call `get_budget_status`, then report the percentage used and whether the threshold is exceeded

**Email sync:**
User: "Sync my ride emails"
-> Call `sync_ride_emails` with no params (syncs new emails since last sync)

**Historical sync:**
User: "Sync my ride emails for the past 3 months"
-> Call `sync_ride_emails` with months=3

**Screenshot:**
User sends a receipt image
-> Call `parse_receipt_screenshot` with the image URL
-> Present the extracted data to the user for confirmation
-> If confirmed, call `log_ride` with the extracted data

**Location search:**
User: "Show me all my rides to the airport"
-> Call `search_rides` with query=airport

**Update a ride:**
User: "Change ride 42 to work category"
-> Call `update_ride` with ride_id=42, category=work

**Delete a ride:**
User: "Delete ride 42"
-> Call `delete_ride` with ride_id=42

## Slash Commands

These are also available as instant slash commands (no AI needed):
- `/rides` -- show last 10 rides in a table
- `/rides_stats` -- current month spending summary
- `/rides_sync` -- trigger email sync (accepts optional months, e.g. `/rides_sync 6`)
- `/rides_reset` -- delete all rides and reset sync cursor

Mention these to the user when they want quick access without a conversational response.

## Important Behavior

- **Screenshot confirmation:** Always present extracted screenshot data to the user and ask for confirmation before logging. Never auto-log from a screenshot.
- **Budget not set:** If `get_budget_status` returns `has_budget: false`, tell the user they haven't set a budget yet and offer to help them set one.
- **Gmail not connected:** If `sync_ride_emails` returns an error about sync not being enabled or Gmail not connected, guide the user through the full setup process (see Gmail Setup Guide below).
- **Currency conversion:** When rides are in a different currency than the budget currency, they are automatically converted using cached exchange rates. If a ride has `normalized_amount: null`, the exchange rate was unavailable at the time and will be backfilled later.
- **Amounts:** The tools accept amounts in dollars (e.g., 15.50), not cents. The tools return amounts in dollars too.

## Gmail Setup Guide

When Gmail is not connected and the user wants to sync emails, **first present the security notice below**, then wait for the user to acknowledge before walking them through the setup steps one at a time. Wait for the user to complete each step before moving to the next.

### Before you start: Security notice

Present this to the user before beginning setup. Keep it concise but cover the key points:

> **Before connecting Gmail, here's what you should know:**
>
> This integration requests **read-only access to your entire Gmail inbox** (`gmail.readonly` scope). While the plugin only searches for ride receipts from Grab, Gojek, and Zig, the OAuth token itself can technically access all your emails.
>
> - The token is stored in plaintext at `~/.openclaw/rides/tokens.json` (with restricted file permissions)
> - The refresh token **never expires** unless you explicitly revoke it
> - If `tokens.json` gets included in cloud backups or file sync, the token travels with it
>
> **Recommendations:** Only connect Gmail on a machine you trust. Exclude `~/.openclaw/rides/tokens.json` from cloud backup and file sync. You can disconnect anytime with `/rides_disconnect` and revoke access at [Google Account Security](https://myaccount.google.com/permissions).
>
> Gmail sync is entirely optional -- you can always log rides manually or via screenshots.

Ask the user if they'd like to proceed. If they say yes, start the setup steps below.

### Step 1: Create a Google Cloud project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project (or use an existing one), e.g. "OpenClaw Rides"

### Step 2: Enable the Gmail API

1. Go to **APIs & Services** > **Library**
2. Search for "Gmail API" and click **Enable**

### Step 3: Configure the OAuth consent screen

1. Go to **APIs & Services** > **OAuth consent screen**
2. Select **External** user type (or Internal if using Google Workspace)
3. Fill in the required fields: App name, User support email, Developer contact email
4. Click **Create**

### Step 4: Add test users

1. Go to **APIs & Services** > **OAuth consent screen** > **Audience**
2. Click **Add Users** and add the Gmail account that receives your ride receipt emails
3. Save

Only test users can authorize the app while it is in Testing mode.

### Step 5: Create OAuth2 credentials

1. Go to **APIs & Services** > **Credentials**
2. Click **Create Credentials** > **OAuth client ID**
3. Application type: **Web application**
4. Under **Authorized redirect URIs**, add: `{baseUrl}/rides/gmail/callback` (e.g. `http://localhost:18789/rides/gmail/callback`)
5. Click **Create**, then copy the **Client ID** and **Client Secret**

### Step 6: Add credentials to plugin config

Tell the user to edit `~/.openclaw/openclaw.json` and add credentials under `plugins.entries.rides.config`:

```json
{
  "plugins": {
    "entries": {
      "rides": {
        "enabled": true,
        "config": {
          "googleClientId": "YOUR_CLIENT_ID",
          "googleClientSecret": "YOUR_CLIENT_SECRET",
          "baseUrl": "http://localhost:18789"
        }
      }
    }
  }
}
```

Merge into their existing config -- do not replace the whole file. Then restart the gateway.

### Step 7: Connect Gmail

1. Open browser to: `{baseUrl}/rides/gmail/auth`
2. Complete the Google consent screen
3. They should see "Gmail Connected" on success

After connecting, they can sync emails with `/rides_sync` or by asking you to sync.
