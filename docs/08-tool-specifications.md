# Tool Specifications

## Overview

All tools are registered via `api.registerTool()` as `AnyAgentTool` objects following the OpenAI-compatible function calling schema. Each tool has:
- `type: "function"`
- `function.name` — tool identifier
- `function.description` — natural language description for the LLM
- `function.parameters` — JSON Schema for input validation
- A handler function (via `OpenClawPluginToolFactory` pattern)

---

## Tool 1: `log_ride`

### Purpose
Manually record a ride-hailing trip.

### JSON Schema
```json
{
  "type": "function",
  "function": {
    "name": "log_ride",
    "description": "Log a ride-hailing trip from Grab, Gojek, or Tada. Use this when the user tells you about a ride they took.",
    "parameters": {
      "type": "object",
      "required": ["provider", "amount"],
      "properties": {
        "provider": {
          "type": "string",
          "enum": ["grab", "gojek", "tada"],
          "description": "Ride-hailing provider"
        },
        "amount": {
          "type": "number",
          "description": "Fare amount in SGD (e.g., 15.50, not cents)"
        },
        "date": {
          "type": "string",
          "description": "Trip date in ISO 8601 format. Defaults to now if omitted."
        },
        "pickup": {
          "type": "string",
          "description": "Pickup location"
        },
        "dropoff": {
          "type": "string",
          "description": "Dropoff location"
        },
        "category": {
          "type": "string",
          "enum": ["work", "personal"],
          "description": "Trip category. Defaults to the configured default."
        }
      }
    }
  }
}
```

### Handler Logic
```
1. Convert amount to cents: Math.round(amount * 100)
2. Parse date to Unix ms, or use Date.now()
3. Use defaultCategory from pluginConfig if category not provided
4. INSERT INTO rides (provider, amount, currency, date, pickup, dropoff, category, source, confidence)
   VALUES (?, ?, 'SGD', ?, ?, ?, ?, 'manual', 1.0)
5. Return { id, message: "Logged {provider} ride: ${amount} on {date}" }
```

---

## Tool 2: `list_rides`

### Purpose
List recent rides with optional filters.

### JSON Schema
```json
{
  "type": "function",
  "function": {
    "name": "list_rides",
    "description": "List recent ride-hailing trips. Supports filtering by provider, category, and date range.",
    "parameters": {
      "type": "object",
      "properties": {
        "limit": {
          "type": "number",
          "description": "Max rides to return (default 10, max 50)"
        },
        "provider": {
          "type": "string",
          "enum": ["grab", "gojek", "tada"],
          "description": "Filter by provider"
        },
        "category": {
          "type": "string",
          "enum": ["work", "personal"],
          "description": "Filter by category"
        },
        "start_date": {
          "type": "string",
          "description": "Start date filter (ISO 8601)"
        },
        "end_date": {
          "type": "string",
          "description": "End date filter (ISO 8601)"
        }
      }
    }
  }
}
```

### Handler Logic
```
1. Clamp limit to [1, 50], default 10
2. Build WHERE clause dynamically from provided filters
3. SELECT id, provider, amount, currency, date, pickup, dropoff, category, source, confidence
   FROM rides WHERE {filters} ORDER BY date DESC LIMIT ?
4. Convert amounts from cents to dollars for display
5. Format dates to ISO strings
6. Return { rides: [...], total: count }
```

---

## Tool 3: `ride_spending_stats`

### Purpose
Get aggregated spending statistics.

### JSON Schema
```json
{
  "type": "function",
  "function": {
    "name": "ride_spending_stats",
    "description": "Get ride spending statistics for a date range. Can break down by provider, category, or month.",
    "parameters": {
      "type": "object",
      "required": ["start_date", "end_date"],
      "properties": {
        "start_date": {
          "type": "string",
          "description": "Start date (ISO 8601)"
        },
        "end_date": {
          "type": "string",
          "description": "End date (ISO 8601)"
        },
        "group_by": {
          "type": "string",
          "enum": ["provider", "category", "month"],
          "description": "How to break down the stats (default: provider)"
        }
      }
    }
  }
}
```

### Handler Logic
```
1. Parse start_date, end_date to Unix ms
2. Default group_by to "provider"
3. Run aggregation query:
   - "provider": GROUP BY provider
   - "category": GROUP BY category
   - "month": GROUP BY strftime('%Y-%m', date/1000, 'unixepoch')
4. Also get total: SELECT SUM(amount), COUNT(*) FROM rides WHERE date BETWEEN ? AND ?
5. Convert amounts from cents to dollars
6. Return { total_amount, total_rides, breakdown: [{ group, amount, count }], currency: "SGD" }
```

---

## Tool 4: `search_rides`

### Purpose
Search rides by location text.

### JSON Schema
```json
{
  "type": "function",
  "function": {
    "name": "search_rides",
    "description": "Search rides by pickup or dropoff location. Use when the user asks about rides to/from a specific place.",
    "parameters": {
      "type": "object",
      "required": ["query"],
      "properties": {
        "query": {
          "type": "string",
          "description": "Location search term (e.g., 'Orchard', 'MBS', 'Airport')"
        },
        "limit": {
          "type": "number",
          "description": "Max results (default 10)"
        }
      }
    }
  }
}
```

### Handler Logic
```
1. SELECT * FROM rides
   WHERE pickup LIKE '%' || ? || '%' OR dropoff LIKE '%' || ? || '%'
   ORDER BY date DESC LIMIT ?
2. Convert amounts and dates
3. Return { rides: [...] }
```

---

## Tool 5: `update_ride`

### Purpose
Edit an existing ride's details.

### JSON Schema
```json
{
  "type": "function",
  "function": {
    "name": "update_ride",
    "description": "Update details of an existing ride (amount, category, locations).",
    "parameters": {
      "type": "object",
      "required": ["ride_id"],
      "properties": {
        "ride_id": {
          "type": "number",
          "description": "ID of the ride to update"
        },
        "amount": {
          "type": "number",
          "description": "New fare amount in SGD"
        },
        "category": {
          "type": "string",
          "enum": ["work", "personal"]
        },
        "pickup": {
          "type": "string",
          "description": "New pickup location"
        },
        "dropoff": {
          "type": "string",
          "description": "New dropoff location"
        }
      }
    }
  }
}
```

### Handler Logic
```
1. Verify ride exists: SELECT id FROM rides WHERE id = ?
2. Build SET clause from provided fields (only update what's given)
3. If amount provided, convert to cents
4. Always set manually_edited = 1
5. UPDATE rides SET {fields}, manually_edited = 1 WHERE id = ?
6. Return { success: true, message: "Ride {id} updated" }
```

---

## Tool 6: `delete_ride`

### Purpose
Remove a ride from the database.

### JSON Schema
```json
{
  "type": "function",
  "function": {
    "name": "delete_ride",
    "description": "Delete a ride record. This cannot be undone.",
    "parameters": {
      "type": "object",
      "required": ["ride_id"],
      "properties": {
        "ride_id": {
          "type": "number",
          "description": "ID of the ride to delete"
        }
      }
    }
  }
}
```

### Handler Logic
```
1. DELETE FROM rides WHERE id = ?
2. Check rowsAffected > 0
3. Return { success: boolean, message: "Ride deleted" | "Ride not found" }
```

---

## Tool 7: `set_ride_budget`

### Purpose
Set or update the monthly spending limit.

### JSON Schema
```json
{
  "type": "function",
  "function": {
    "name": "set_ride_budget",
    "description": "Set a monthly ride spending budget. This replaces any existing budget.",
    "parameters": {
      "type": "object",
      "required": ["monthly_limit"],
      "properties": {
        "monthly_limit": {
          "type": "number",
          "description": "Monthly limit in SGD (e.g., 500 for $500)"
        },
        "alert_threshold": {
          "type": "number",
          "description": "Alert when spending exceeds this fraction of the limit (0.0-1.0, default 0.8 = 80%)"
        }
      }
    }
  }
}
```

### Handler Logic
```
1. Convert monthly_limit to cents: Math.round(monthly_limit * 100)
2. Clamp alert_threshold to [0, 1], default 0.8
3. DELETE FROM budgets
4. INSERT INTO budgets (monthly_limit, currency, alert_threshold, updated_at)
   VALUES (?, 'SGD', ?, ?)
5. Return { success: true, monthly_limit, alert_threshold }
```

---

## Tool 8: `get_budget_status`

### Purpose
Check current month's spending against the budget.

### JSON Schema
```json
{
  "type": "function",
  "function": {
    "name": "get_budget_status",
    "description": "Get current month's ride spending relative to the budget. Shows total spent, remaining, and whether the alert threshold has been exceeded.",
    "parameters": {
      "type": "object",
      "properties": {}
    }
  }
}
```

### Handler Logic
```
1. Get budget: SELECT monthly_limit, alert_threshold FROM budgets ORDER BY id DESC LIMIT 1
2. Compute current month boundaries (first day 00:00:00 to first day of next month)
3. SELECT SUM(amount) as total_spent, COUNT(*) as ride_count FROM rides
   WHERE date >= ? AND date < ?
4. Calculate percentage_used = total_spent / monthly_limit
5. Return {
     has_budget: boolean,
     monthly_limit (dollars),
     total_spent (dollars),
     remaining (dollars),
     percentage_used (0-1),
     threshold_exceeded: percentage_used >= alert_threshold,
     alert_threshold,
     ride_count,
     currency: "SGD"
   }
```

---

## Tool 9: `sync_ride_emails`

### Purpose
Trigger an immediate Gmail email sync.

### JSON Schema
```json
{
  "type": "function",
  "function": {
    "name": "sync_ride_emails",
    "description": "Sync ride receipts from Gmail. Fetches emails from Grab, Gojek, and Tada, extracts ride data, and saves new rides. Requires Gmail to be connected via OAuth.",
    "parameters": {
      "type": "object",
      "properties": {
        "provider": {
          "type": "string",
          "enum": ["grab", "gojek", "tada"],
          "description": "Only sync this specific provider. Omit to sync all."
        }
      }
    }
  }
}
```

### Handler Logic
```
1. Call syncEmails(db, pluginConfig, provider?)
2. Return { success, emails_processed, rides_created, errors }
```

---

## Tool 10: `parse_receipt_screenshot`

### Purpose
Extract ride data from a receipt screenshot image.

### JSON Schema
```json
{
  "type": "function",
  "function": {
    "name": "parse_receipt_screenshot",
    "description": "Extract ride data from a receipt screenshot. Send this tool a receipt image from Grab, Gojek, or Tada and it will extract the provider, amount, date, and locations. After extraction, ask the user to confirm before logging the ride.",
    "parameters": {
      "type": "object",
      "required": ["image_url"],
      "properties": {
        "image_url": {
          "type": "string",
          "description": "URL of the receipt image"
        }
      }
    }
  }
}
```

### Handler Logic
```
1. Check googleAiApiKey is configured → if not, return { error: "screenshot_parsing_disabled" }
2. Fetch image from image_url
3. Validate: supported MIME type, file size ≤ 10MB
4. Convert to base64
5. Call Gemini 2.0 Flash with extraction prompt (same as original app)
6. Parse JSON response, strip markdown if present
7. Validate: is valid provider, positive amount, confidence 0-1
8. Return extracted data or { error: "not_a_receipt" }
```

### Gemini Prompt (from original)
```
Extract ride receipt data from this screenshot. Singapore ride-hailing apps only (Grab, Gojek, Tada).

Return ONLY valid JSON, no markdown code blocks or other text:
{
  "provider": "grab" | "gojek" | "tada",
  "amount": <number in SGD, e.g., 15.50 not 1550>,
  "date": "<ISO 8601 format or null if unclear>",
  "pickup": "<pickup address or null>",
  "dropoff": "<dropoff address or null>",
  "confidence": <0.0-1.0, your confidence in the extraction>
}

If this is not a valid ride receipt from Grab, Gojek, or Tada, return:
{"error": "not_a_receipt"}
```
