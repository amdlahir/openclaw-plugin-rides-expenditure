import type { Client } from "@libsql/client";

const RIDES_TABLE = `
CREATE TABLE IF NOT EXISTS rides (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  provider            TEXT    NOT NULL CHECK (provider IN ('grab', 'gojek')),
  original_amount     INTEGER NOT NULL,
  original_currency   TEXT    NOT NULL,
  normalized_amount   INTEGER,
  normalized_currency TEXT,
  date                INTEGER NOT NULL,
  pickup              TEXT,
  dropoff             TEXT,
  category            TEXT    NOT NULL DEFAULT 'personal'
                              CHECK (category IN ('work', 'personal')),
  source              TEXT    NOT NULL
                              CHECK (source IN ('email', 'screenshot', 'manual')),
  raw_email_id        TEXT    UNIQUE,
  confidence          REAL    NOT NULL DEFAULT 1.0,
  manually_edited     INTEGER NOT NULL DEFAULT 0,
  created_at          INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
);
`;

const RIDES_INDEXES = `
CREATE INDEX IF NOT EXISTS idx_rides_date       ON rides (date);
CREATE INDEX IF NOT EXISTS idx_rides_provider   ON rides (provider);
CREATE INDEX IF NOT EXISTS idx_rides_category   ON rides (category);
`;

const BUDGETS_TABLE = `
CREATE TABLE IF NOT EXISTS budgets (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  monthly_limit   INTEGER NOT NULL,
  currency        TEXT    NOT NULL DEFAULT 'SGD',
  alert_threshold REAL    NOT NULL DEFAULT 0.8,
  updated_at      INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
);
`;

const SYNC_STATE_TABLE = `
CREATE TABLE IF NOT EXISTS sync_state (
  id                       INTEGER PRIMARY KEY CHECK (id = 1),
  last_sync_at             INTEGER,
  gmail_access_token       TEXT,
  gmail_refresh_token      TEXT,
  gmail_token_expires_at   INTEGER,
  email_sync_enabled       INTEGER NOT NULL DEFAULT 0,
  oauth_nonce              TEXT
);
`;

const SYNC_STATE_SEED = `
INSERT OR IGNORE INTO sync_state (id) VALUES (1);
`;

const SYNC_LOGS_TABLE = `
CREATE TABLE IF NOT EXISTS sync_logs (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp         INTEGER NOT NULL,
  emails_processed  INTEGER NOT NULL DEFAULT 0,
  rides_created     INTEGER NOT NULL DEFAULT 0,
  errors            TEXT,
  notified_at       INTEGER,
  created_at        INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
);
`;

const SYNC_LOGS_INDEX = `
CREATE INDEX IF NOT EXISTS idx_sync_logs_timestamp ON sync_logs (timestamp);
`;

const EXCHANGE_RATES_TABLE = `
CREATE TABLE IF NOT EXISTS exchange_rates (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  from_currency TEXT    NOT NULL,
  to_currency   TEXT    NOT NULL,
  rate          REAL    NOT NULL,
  fetched_at    INTEGER NOT NULL
);
`;

const EXCHANGE_RATES_INDEX = `
CREATE UNIQUE INDEX IF NOT EXISTS idx_exchange_rates_pair
  ON exchange_rates (from_currency, to_currency);
`;

export async function runMigrations(db: Client): Promise<void> {
  const statements = [
    RIDES_TABLE,
    RIDES_INDEXES,
    BUDGETS_TABLE,
    SYNC_STATE_TABLE,
    SYNC_STATE_SEED,
    SYNC_LOGS_TABLE,
    SYNC_LOGS_INDEX,
    EXCHANGE_RATES_TABLE,
    EXCHANGE_RATES_INDEX,
  ];

  for (const sql of statements) {
    for (const stmt of sql.split(";").filter((s) => s.trim())) {
      await db.execute(stmt);
    }
  }
}
