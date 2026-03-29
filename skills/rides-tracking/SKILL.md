---
name: rides-tracking
description: Track ride-hailing expenses from Grab and Gojek across SGD, USD, and MYR
---

# Ride Expense Tracking

You have ride-hailing expense tracking tools available. Use them when the user mentions rides, Grab, Gojek, fares, ride expenses, or transportation costs.

## Available Tools

| Tool | When to use |
|------|-------------|
| `log_ride` | User tells you about a ride they took |
| `list_rides` | User wants to see recent rides or ride history |
| `search_rides` | User asks about rides to/from a specific place |
| `ride_spending_stats` | User asks about spending, totals, or breakdowns |
| `update_ride` | User wants to correct a ride's details |
| `delete_ride` | User wants to remove a ride |
| `set_ride_budget` | User wants to set or change their monthly limit |
| `get_budget_status` | User asks about budget, remaining balance, or how much they've spent |
| `sync_ride_emails` | User wants to pull ride receipts from Gmail |
| `parse_receipt_screenshot` | User sends a receipt image |

## Supported Providers

- **Grab** — Singapore, Malaysia
- **Gojek** — Singapore

## Supported Currencies

SGD, USD, MYR. Amounts are stored in the original currency and normalized to the user's budget currency for aggregation.

## Example Flows

**Manual logging:**
User: "I took a Grab for $15.50 from Orchard to Bugis"
→ Call `log_ride` with provider=grab, amount=15.50, pickup=Orchard, dropoff=Bugis

**Spending check:**
User: "How much did I spend on rides this month?"
→ Call `ride_spending_stats` with current month date range

**Screenshot:**
User sends a receipt image
→ Call `parse_receipt_screenshot`, present extracted data, ask for confirmation, then call `log_ride`

**Location search:**
User: "Show me all my rides to the airport"
→ Call `search_rides` with query=airport
