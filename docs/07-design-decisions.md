# Design Decisions

## 1. Single-User, No Auth

**Decision:** Remove all authentication and user-scoping (Clerk, userId columns, multi-user queries).

**Rationale:** The plugin runs on the OpenClaw installer's own machine, serving only them. Adding auth adds complexity with no benefit. The `sync_state` table is a singleton row (enforced by `CHECK (id = 1)`), and no table has a `userId` column.

**Trade-off:** Cannot be extended to multi-user without adding columns and scoping all queries. This is intentional — multi-user would require a fundamentally different architecture (centralized server, not local plugin).

---

## 2. libSQL over Convex

**Decision:** Replace Convex serverless database with `@libsql/client` (local SQLite file).

**Rationale:**
- Convex requires a hosted service + API keys + deployment pipeline
- Local SQLite is zero-config, works offline, and fits the single-user model
- `@libsql/client` provides a clean async API compatible with both local files and Turso cloud (future option)
- No server round-trips — all queries are local

**Migration path from Convex:**
- `ctx.db.query("table").collect()` → `db.execute("SELECT * FROM table")`
- `ctx.db.insert("table", data)` → `db.execute("INSERT INTO table ...")`
- `ctx.db.patch(id, data)` → `db.execute("UPDATE table SET ... WHERE id = ?")`
- `.withIndex("by_X", q => q.eq("field", val))` → `WHERE field = ?` with SQL index
- Convex reactive queries → not needed (tools are request/response, not real-time)

---

## 3. INSERT OR IGNORE for Dedup

**Decision:** Use SQLite `UNIQUE` constraint on `raw_email_id` + `INSERT OR IGNORE` instead of pre-query duplicate checks.

**Rationale:** The original Convex code does:
```
const existing = await ctx.db.query("rides").withIndex("by_emailId", ...).unique();
if (existing) return { created: false };
```

This requires two round-trips. With SQLite, the `UNIQUE` constraint handles this atomically in a single statement. `INSERT OR IGNORE` silently skips the insert if the constraint would be violated. Check `db.execute().rowsAffected` to determine if the row was inserted.

---

## 4. Source = "manual" Added

**Decision:** Add `"manual"` as a third `source` type (alongside `"email"` and `"screenshot"`).

**Rationale:** In the original app, rides are only created via email sync or screenshot upload. In the plugin, users can also dictate rides through natural language ("I took a Grab ride for $12 from MBS to Bugis"). These need a distinct source type for accurate tracking.

---

## 5. Single-Step Screenshot Processing

**Decision:** Replace the original two-step flow (processScreenshot → user reviews → confirmScreenshotRide) with a single tool call.

**Rationale:** The original app has a React UI with a review modal. In the chat-based plugin, the AI agent naturally handles the confirmation dialog:

1. User sends image
2. Agent calls `parse_receipt_screenshot` → gets extracted data
3. Agent presents data to user: "I extracted: Grab, $15.50, Orchard → Bugis. Should I log this?"
4. User confirms
5. Agent calls `log_ride` with the data

This is more natural in a conversational interface and avoids storing pending state.

---

## 6. No Image Storage

**Decision:** Process screenshots in-memory without persisting the image file.

**Rationale:** The original app stores screenshots in Convex file storage (referenced by `screenshotId`). In the plugin:
- Images come from messaging channels (WhatsApp, Telegram) as URLs
- The URL is typically temporary/expiring
- The extracted data is what matters, not the raw image
- Storing images would require managing a file storage system

Trade-off: No "view original screenshot" feature. The extracted data is the only record.

---

## 7. setInterval for Background Sync

**Decision:** Use `setInterval` inside a registered service instead of a cron system.

**Rationale:** OpenClaw services have `start`/`stop` lifecycle hooks. The simplest approach is:
- `start()`: check if sync is enabled, set up `setInterval(syncEmails, interval)`
- `stop()`: `clearInterval(timer)`

The original used Convex's built-in cron system (`crons.interval("name", { minutes: 15 }, handler)`). `setInterval` is the equivalent for a Node.js service context.

**Consideration:** If the OpenClaw process restarts, the interval resets (no catch-up for missed syncs). This is acceptable because:
- `last_sync_at` is persisted, so the next sync fetches everything since the last successful run
- Gmail's `after:` query parameter handles the window correctly
- No data is lost, just delayed

---

## 8. SKILL.md for Tool Awareness

**Decision:** Use a `SKILL.md` file (declared via `"skills"` in `openclaw.plugin.json`) instead of a `before_prompt_build` hook.

**Rationale:** Skills are the idiomatic OpenClaw mechanism for teaching the agent about plugin capabilities. A `SKILL.md` file with YAML frontmatter and markdown instructions is automatically loaded by OpenClaw and injected into the agent's context. This is preferred over a `before_prompt_build` hook because:
- Skills participate in OpenClaw's skill precedence and enablement system
- They can be discovered, listed, and toggled by the user via `/skills`
- No plugin code executes to provide the context — it's declarative
- Skills can be overridden at the workspace level if the user wants to customize behavior

---

## 9. Commands Duplicate Tool Functionality

**Decision:** The 3 commands (`/rides`, `/rides-stats`, `/rides-sync`) overlap with corresponding tools.

**Rationale:** Commands are instant (no LLM invocation), cheaper, and predictable. Tools are flexible (the agent can combine data, answer follow-ups). Both serve valid use cases:
- `/rides` for quick glance — instant, formatted output
- "Show my rides from last week" via tool — requires LLM to parse the date range and call `list_rides`

---

## 10. All Amounts in SGD Cents

**Decision:** Normalize all amounts to SGD cents regardless of original currency.

**Rationale:** The original app does this. The parsers extract amounts in their local currency (IDR, THB, VND) and convert to cents of that currency, but the schema and display assume SGD. This simplifies aggregation and budget comparison.

**Trade-off:** Non-SGD amounts are technically stored in the wrong unit (e.g., Rp90,000 stored as 9,000,000 "SGD cents"). The `currency` column is always "SGD" even for Indonesian rides.

**Future improvement:** Store original currency + amount, add exchange rate conversion. Not in scope for v1.

---

## 11. OAuth State Parameter

**Decision:** Use a random nonce for the OAuth `state` parameter instead of encoding user identity.

**Rationale:** The original encodes `{ clerkId }` in base64 as the `state` parameter to identify which user is completing OAuth. Since the plugin is single-user, there's no user to identify. A random nonce stored in the `sync_state` table provides CSRF protection without user identity concerns.

---

## 12. Plugin Config via openclaw.json

**Decision:** Require `googleClientId`, `googleClientSecret`, and `baseUrl` in plugin config rather than environment variables.

**Rationale:** OpenClaw's plugin config system (`api.pluginConfig`) provides structured, validated configuration. Environment variables would work but are less discoverable and not validated at plugin load time.

The `configSchema` in `openclaw.plugin.json` defines the shape, and OpenClaw validates it before calling `register()`. This catches misconfiguration early.
