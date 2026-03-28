# Database Schema

## Overview

Local SQLite database via `@libsql/client`, stored at:
```
~/.openclaw/rides-expenditure/rides.db
```

Path resolved via `api.runtime.state.resolveStateDir()` + `/rides-expenditure/rides.db`.

All amounts are stored in **SGD cents** (integer). All timestamps are **Unix milliseconds** (integer).

## Entity Relationship

```
+------------------+     +------------------+
|      rides       |     |     budgets      |
+------------------+     +------------------+
| id (PK)          |     | id (PK)          |
| provider         |     | monthly_limit    |
| amount           |     | currency         |
| currency         |     | alert_threshold  |
| date             |     | updated_at       |
| pickup           |     +------------------+
| dropoff          |
| category         |     +------------------+
| source           |     |   sync_state     |
| raw_email_id (U) |     +------------------+
| confidence       |     | id (PK, =1)      |
| manually_edited  |     | last_sync_at     |
| created_at       |     | gmail_access_    |
+------------------+     |   token          |
                          | gmail_refresh_   |
+------------------+     |   token          |
|   sync_logs      |     | gmail_token_     |
+------------------+     |   expires_at     |
| id (PK)          |     | email_sync_      |
| timestamp        |     |   enabled        |
| emails_processed |     +------------------+
| rides_created    |
| errors           |
| created_at       |
+------------------+
```

## Table Definitions

### rides

Stores individual ride records from all sources (email, screenshot, manual).

```sql
CREATE TABLE IF NOT EXISTS rides (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  provider        TEXT    NOT NULL CHECK (provider IN ('grab', 'gojek', 'tada')),
  amount          INTEGER NOT NULL,                 -- SGD cents
  currency        TEXT    NOT NULL DEFAULT 'SGD',
  date            INTEGER NOT NULL,                 -- Unix timestamp ms
  pickup          TEXT,
  dropoff         TEXT,
  category        TEXT    NOT NULL DEFAULT 'personal'
                          CHECK (category IN ('work', 'personal')),
  source          TEXT    NOT NULL
                          CHECK (source IN ('email', 'screenshot', 'manual')),
  raw_email_id    TEXT    UNIQUE,                    -- Gmail message ID (dedup)
  confidence      REAL    NOT NULL DEFAULT 1.0,      -- 0.0 - 1.0
  manually_edited INTEGER NOT NULL DEFAULT 0,        -- boolean
  created_at      INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
);

CREATE INDEX IF NOT EXISTS idx_rides_date       ON rides (date);
CREATE INDEX IF NOT EXISTS idx_rides_provider   ON rides (provider);
CREATE INDEX IF NOT EXISTS idx_rides_category   ON rides (category);
```

**Design decisions vs original Convex schema:**

| Aspect | Original (Convex) | Plugin (libSQL) |
|--------|-------------------|-----------------|
| User scoping | `userId` column + index on every table | No userId anywhere (single-user) |
| Deduplication | `by_emailId` index + query check | `UNIQUE` constraint + `INSERT OR IGNORE` |
| Source types | `email`, `screenshot` | `email`, `screenshot`, `manual` (added for chat-based logging) |
| Screenshot ref | `screenshotId` FK to `_storage` | Not stored (images processed in-memory, not persisted) |

### budgets

Monthly spending limit configuration. Effectively a single-row table.

```sql
CREATE TABLE IF NOT EXISTS budgets (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  monthly_limit   INTEGER NOT NULL,                 -- SGD cents
  currency        TEXT    NOT NULL DEFAULT 'SGD',
  alert_threshold REAL    NOT NULL DEFAULT 0.8,     -- 0.0 - 1.0
  updated_at      INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
);
```

Budget operations use UPSERT pattern: only the most recent row matters. On `set_ride_budget`, delete all existing rows and insert fresh.

### sync_state

Singleton row storing Gmail OAuth tokens and sync cursor. The `CHECK (id = 1)` constraint enforces exactly one row.

```sql
CREATE TABLE IF NOT EXISTS sync_state (
  id                       INTEGER PRIMARY KEY CHECK (id = 1),
  last_sync_at             INTEGER,
  gmail_access_token       TEXT,
  gmail_refresh_token      TEXT,
  gmail_token_expires_at   INTEGER,
  email_sync_enabled       INTEGER NOT NULL DEFAULT 0   -- boolean
);

-- Seed the singleton row
INSERT OR IGNORE INTO sync_state (id) VALUES (1);
```

**Token lifecycle:**
1. OAuth callback writes `gmail_access_token`, `gmail_refresh_token`, `gmail_token_expires_at`, sets `email_sync_enabled = 1`
2. Sync service reads tokens before each cycle
3. If `gmail_token_expires_at < now + 5min`, refresh via Google token endpoint, update row
4. Disconnect clears all token fields, sets `email_sync_enabled = 0`

### sync_logs

Audit trail for email sync operations.

```sql
CREATE TABLE IF NOT EXISTS sync_logs (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp         INTEGER NOT NULL,
  emails_processed  INTEGER NOT NULL DEFAULT 0,
  rides_created     INTEGER NOT NULL DEFAULT 0,
  errors            TEXT,                            -- JSON array of strings
  created_at        INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
);

CREATE INDEX IF NOT EXISTS idx_sync_logs_timestamp ON sync_logs (timestamp);
```

## Common Query Patterns

### List rides (paginated, filtered)

```sql
SELECT * FROM rides
WHERE (:provider IS NULL OR provider = :provider)
  AND (:category IS NULL OR category = :category)
  AND (:start_date IS NULL OR date >= :start_date)
  AND (:end_date IS NULL OR date <= :end_date)
ORDER BY date DESC
LIMIT :limit;
```

### Spending stats (aggregated)

```sql
-- By provider
SELECT provider, SUM(amount) as total, COUNT(*) as count
FROM rides
WHERE date >= :start_date AND date <= :end_date
GROUP BY provider;

-- By category
SELECT category, SUM(amount) as total, COUNT(*) as count
FROM rides
WHERE date >= :start_date AND date <= :end_date
GROUP BY category;

-- Monthly breakdown
SELECT
  strftime('%Y-%m', date / 1000, 'unixepoch') as month,
  SUM(amount) as total,
  COUNT(*) as count
FROM rides
WHERE date >= :start_date AND date <= :end_date
GROUP BY month
ORDER BY month DESC;
```

### Budget status (current month)

```sql
-- Current month total
SELECT SUM(amount) as total_spent
FROM rides
WHERE date >= :month_start AND date < :month_end;

-- Budget limit
SELECT monthly_limit, alert_threshold FROM budgets
ORDER BY id DESC LIMIT 1;
```

### Dedup on email insert

```sql
INSERT OR IGNORE INTO rides (provider, amount, currency, date, pickup, dropoff, category, source, raw_email_id, confidence)
VALUES (:provider, :amount, 'SGD', :date, :pickup, :dropoff, :category, 'email', :raw_email_id, :confidence);
```

The `UNIQUE` constraint on `raw_email_id` silently skips duplicates. The return value of `changes()` indicates whether the row was inserted (1) or skipped (0).

### Search rides by location

```sql
SELECT * FROM rides
WHERE (pickup LIKE '%' || :query || '%' OR dropoff LIKE '%' || :query || '%')
ORDER BY date DESC
LIMIT :limit;
```

## Migration Strategy

Migrations run synchronously at plugin load time in `register()`. The schema uses `CREATE TABLE IF NOT EXISTS` and `CREATE INDEX IF NOT EXISTS` for idempotent initialization. Future schema changes should use a `schema_version` table:

```sql
CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER NOT NULL
);
```

Check version, apply incremental ALTER/CREATE statements, update version. For v1, this table is not needed since the initial schema is idempotent.
