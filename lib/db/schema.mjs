// lib/db/schema.mjs — schema DDL shared by every store driver.
//
// Imported by the local node:sqlite driver, the D1 binding driver (Workers),
// and the D1 HTTP driver (scripts). Keeping the DDL here means migrations
// run identically wherever the data layer opens.

export const SCHEMA_VERSION = 1
export const HISTORY_CAP = 500

export const DDL = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  wallet_address TEXT NOT NULL UNIQUE,
  username TEXT,
  created_at TEXT NOT NULL,
  last_login_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS markets (
  id INTEGER PRIMARY KEY,
  market_id TEXT NOT NULL UNIQUE,
  onchain_market_id INTEGER UNIQUE,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  question TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL,
  continent TEXT NOT NULL,
  country TEXT,
  region TEXT NOT NULL,
  latitude REAL NOT NULL,
  longitude REAL NOT NULL,
  resolution_source TEXT NOT NULL,
  resolution_source_url TEXT NOT NULL,
  resolution_rules TEXT NOT NULL,
  status TEXT NOT NULL,
  outcome TEXT NOT NULL,
  yes_price REAL NOT NULL,
  no_price REAL NOT NULL,
  yes_liquidity REAL NOT NULL,
  no_liquidity REAL NOT NULL,
  total_volume REAL NOT NULL,
  featured INTEGER NOT NULL DEFAULT 0,
  trending_score REAL NOT NULL DEFAULT 0,
  resolver TEXT NOT NULL,
  evidence_json TEXT NOT NULL DEFAULT '[]',
  recent_trades_json TEXT NOT NULL DEFAULT '[]',
  resolution_json TEXT,
  open_at TEXT NOT NULL,
  closes_at TEXT NOT NULL,
  resolves_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_markets_status ON markets(status);
CREATE INDEX IF NOT EXISTS idx_markets_category ON markets(category);
CREATE INDEX IF NOT EXISTS idx_markets_closes ON markets(closes_at);
CREATE TABLE IF NOT EXISTS market_history (
  id INTEGER PRIMARY KEY,
  market_id INTEGER NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
  timestamp TEXT NOT NULL,
  yes_probability REAL NOT NULL,
  no_probability REAL NOT NULL,
  total_volume REAL NOT NULL,
  yes_liquidity REAL NOT NULL,
  no_liquidity REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_history_market_time ON market_history(market_id, timestamp);
CREATE TABLE IF NOT EXISTS market_participants (
  market_id INTEGER NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
  wallet TEXT NOT NULL,
  PRIMARY KEY (market_id, wallet)
);
CREATE TABLE IF NOT EXISTS market_prices (
  id INTEGER PRIMARY KEY,
  market_id INTEGER NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
  timestamp TEXT NOT NULL,
  yes_price REAL NOT NULL,
  no_price REAL NOT NULL,
  volume REAL NOT NULL,
  trigger_event TEXT NOT NULL,
  yes_liquidity REAL,
  no_liquidity REAL,
  total_volume REAL
);
CREATE INDEX IF NOT EXISTS idx_prices_market_time ON market_prices(market_id, timestamp);
CREATE TABLE IF NOT EXISTS positions (
  id TEXT PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  wallet_address TEXT NOT NULL,
  market_row_id INTEGER REFERENCES markets(id),
  market_doc_id TEXT NOT NULL,
  onchain_market_id INTEGER NOT NULL,
  market_question TEXT NOT NULL,
  side TEXT NOT NULL,
  amount_sol REAL NOT NULL,
  amount_lamports TEXT NOT NULL,
  estimated_payout_sol REAL NOT NULL,
  estimated_payout_lamports TEXT NOT NULL,
  status TEXT NOT NULL,
  tx_signature TEXT,
  created_at TEXT NOT NULL,
  settled_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_positions_wallet ON positions(wallet_address);
CREATE INDEX IF NOT EXISTS idx_positions_market ON positions(market_doc_id);
CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  wallet_address TEXT NOT NULL,
  type TEXT NOT NULL,
  chain TEXT NOT NULL DEFAULT 'solana',
  token TEXT NOT NULL DEFAULT 'SOL',
  amount_sol REAL,
  amount_lamports TEXT,
  tx_signature TEXT UNIQUE,
  status TEXT NOT NULL,
  related_market_id INTEGER REFERENCES markets(id),
  market_doc_id TEXT,
  onchain_market_id INTEGER,
  created_at TEXT NOT NULL,
  confirmed_at TEXT,
  failure_reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_tx_user ON transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_tx_status ON transactions(status);
CREATE TABLE IF NOT EXISTS resolutions (
  id INTEGER PRIMARY KEY,
  market_id INTEGER NOT NULL UNIQUE REFERENCES markets(id) ON DELETE CASCADE,
  market_doc_id TEXT NOT NULL,
  data_source TEXT NOT NULL,
  resolved_outcome TEXT NOT NULL,
  resolver_type TEXT NOT NULL,
  resolver_wallet TEXT NOT NULL,
  proof_url TEXT,
  resolved_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS auth_challenges (
  id INTEGER PRIMARY KEY,
  wallet_address TEXT NOT NULL,
  nonce TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_challenges_wallet ON auth_challenges(wallet_address);
`

/** Multi-statement DDL for `wrangler d1 execute --file` / manual setup. */
export const SCHEMA_SQL = DDL
