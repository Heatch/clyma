// lib/db/store.mjs — single SQLite data layer for the app AND scripts.
//
// Replaces the MongoDB driver layer (connection.ts + collections.ts). Both
// the TypeScript repositories and scripts/*.mjs import this module, so there
// is exactly one place that speaks SQL. Row objects are shaped like the TS
// doc types (camelCase, Date instances, string ids).
//
// Requires node:sqlite — on Node 22.5.x run with --experimental-sqlite
// (see .npmrc `node-options` for npm scripts, start-app.bat, docs/DEMO.md).

import { DatabaseSync } from "node:sqlite"
import { mkdirSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const SCHEMA_VERSION = 1
const HISTORY_CAP = 500

function defaultPath() {
  if (process.env.SQLITE_PATH) return resolve(process.env.SQLITE_PATH)
  return join(ROOT, "data", "clyma.db")
}

function likeEscape(value) {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`)
}

const DDL = `
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

let db = null
let dbPath = null

function bool(v) {
  return v ? 1 : 0
}

function migrate(database) {
  const row = one(database.prepare("PRAGMA user_version"))
  if ((row?.user_version ?? 0) >= SCHEMA_VERSION) return
  database.exec(DDL)
  database.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`)
}

export function openStore(path) {
  const target = path ?? defaultPath()
  if (db && dbPath === target) return db
  if (db) db.close()
  if (target !== ":memory:") mkdirSync(dirname(target), { recursive: true })
  db = new DatabaseSync(target)
  db.exec(
    "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;",
  )
  migrate(db)
  dbPath = target
  return db
}

/** Test hook: close + forget the singleton so the next open starts fresh. */
export function __resetStoreForTests() {
  if (db) {
    try {
      db.close()
    } catch {}
  }
  db = null
  dbPath = null
}

function getDb() {
  if (db) return db
  return openStore()
}

/**
 * Normalized single-row read. This node:sqlite build returns a null-filled
 * object (instead of undefined) when no rows match — normalize that to
 * undefined so existence checks work. Aggregates (COUNT/MAX) always return
 * a row and are unaffected unless every selected value is null.
 */
function one(stmt, ...params) {
  const row = stmt.get(...params)
  if (row === undefined || row === null) return undefined
  if (
    typeof row === "object" &&
    Object.values(row).every((value) => value == null)
  ) {
    return undefined
  }
  return row
}

// --- row mapping (snake_case rows -> camelCase doc-like objects) -----------

function marketRow(row) {
  if (!row) return null
  return {
    _id: String(row.id),
    marketId: row.market_id,
    onchainMarketId: row.onchain_market_id,
    title: row.title,
    question: row.question,
    description: row.description,
    slug: row.slug,
    category: row.category,
    continent: row.continent,
    country: row.country,
    region: row.region,
    latitude: row.latitude,
    longitude: row.longitude,
    resolutionSource: row.resolution_source,
    resolutionSourceUrl: row.resolution_source_url,
    resolutionRules: row.resolution_rules,
    status: row.status,
    outcome: row.outcome,
    yesPrice: row.yes_price,
    noPrice: row.no_price,
    yesLiquidity: row.yes_liquidity,
    noLiquidity: row.no_liquidity,
    totalVolume: row.total_volume,
    featured: row.featured === 1,
    trendingScore: row.trending_score,
    resolver: row.resolver,
    evidence: JSON.parse(row.evidence_json || "[]"),
    recentTrades: JSON.parse(row.recent_trades_json || "[]"),
    resolution: row.resolution_json
      ? JSON.parse(row.resolution_json)
      : undefined,
    openAt: new Date(row.open_at),
    closesAt: new Date(row.closes_at),
    resolvesAt: new Date(row.resolves_at),
    createdAt: new Date(row.created_at),
  }
}

function historyRow(row) {
  return {
    timestamp: row.timestamp,
    yesProbability: row.yes_probability,
    noProbability: row.no_probability,
    totalVolume: row.total_volume,
    yesLiquidity: row.yes_liquidity,
    noLiquidity: row.no_liquidity,
  }
}

// --- users ------------------------------------------------------------------

export function upsertUser(walletAddress) {
  const database = getDb()
  const now = new Date().toISOString()
  database
    .prepare(
      `INSERT INTO users (wallet_address, created_at, last_login_at)
       VALUES (?, ?, ?)
       ON CONFLICT(wallet_address) DO UPDATE SET last_login_at = excluded.last_login_at`,
    )
    .run(walletAddress, now, now)
  return getUserByWallet(walletAddress)
}

export function getUserByWallet(walletAddress) {
  const row = one(
    getDb().prepare("SELECT * FROM users WHERE wallet_address = ?"),
    walletAddress,
  )
  if (!row) return null
  return {
    _id: String(row.id),
    walletAddress: row.wallet_address,
    username: row.username ?? undefined,
    createdAt: new Date(row.created_at),
    lastLoginAt: new Date(row.last_login_at),
  }
}

// --- markets ----------------------------------------------------------------

function fullMarket(database, row) {
  const doc = marketRow(row)
  if (!doc) return null
  doc.history = database
    .prepare(
      "SELECT * FROM market_history WHERE market_id = ? ORDER BY timestamp ASC, id ASC",
    )
    .all(row.id)
    .map(historyRow)
  const count = database
    .prepare(
      "SELECT COUNT(*) AS n FROM market_participants WHERE market_id = ?",
    )
    .get(row.id)
  doc.participants = count?.n ?? 0
  return doc
}

export function upsertMarket(doc) {
  const database = getDb()
  const existing = one(
    database.prepare("SELECT id FROM markets WHERE onchain_market_id = ?"),
    doc.onchainMarketId,
  )
  const params = [
    doc.marketId,
    doc.onchainMarketId,
    doc.slug,
    doc.question,
    doc.question,
    doc.description,
    doc.category,
    doc.continent,
    doc.country ?? null,
    doc.region,
    doc.latitude,
    doc.longitude,
    doc.resolutionSource,
    doc.resolutionSourceUrl,
    doc.resolutionRules,
    doc.status,
    doc.outcome,
    doc.yesPrice,
    doc.noPrice,
    doc.yesLiquidity,
    doc.noLiquidity,
    doc.totalVolume,
    bool(doc.featured),
    doc.trendingScore,
    doc.resolver,
    JSON.stringify(doc.evidence ?? []),
    JSON.stringify(doc.recentTrades ?? []),
    doc.resolution ? JSON.stringify(doc.resolution) : null,
    new Date(doc.createdAt).toISOString(),
    new Date(doc.closeTime).toISOString(),
    new Date(doc.resolutionTime ?? doc.closeTime).toISOString(),
    new Date(doc.createdAt).toISOString(),
  ]
  if (existing) {
    database
      .prepare(
        `UPDATE markets SET market_id=?, onchain_market_id=?, slug=?, title=?, question=?,
         description=?, category=?, continent=?, country=?, region=?, latitude=?, longitude=?,
         resolution_source=?, resolution_source_url=?, resolution_rules=?, status=?, outcome=?,
         yes_price=?, no_price=?, yes_liquidity=?, no_liquidity=?, total_volume=?,
         featured=?, trending_score=?, resolver=?, evidence_json=?, recent_trades_json=?,
         resolution_json=?, open_at=?, closes_at=?, resolves_at=?, created_at=?
         WHERE id=?`,
      )
      .run(...params, existing.id)
    return fullMarket(
      database,
      one(database.prepare("SELECT * FROM markets WHERE id=?"), existing.id),
    )
  }
  const info = database
    .prepare(
      `INSERT INTO markets (market_id, onchain_market_id, slug, title, question,
       description, category, continent, country, region, latitude, longitude,
       resolution_source, resolution_source_url, resolution_rules, status, outcome,
       yes_price, no_price, yes_liquidity, no_liquidity, total_volume,
       featured, trending_score, resolver, evidence_json, recent_trades_json,
       resolution_json, open_at, closes_at, resolves_at, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(...params)
  return fullMarket(
    database,
    one(
      database.prepare("SELECT * FROM markets WHERE id=?"),
      info.lastInsertRowid,
    ),
  )
}

function marketFilterClauses(query) {
  const clauses = []
  const params = []
  if (query.search) {
    clauses.push(
      "(title LIKE ? ESCAPE '\\' OR question LIKE ? ESCAPE '\\' OR region LIKE ? ESCAPE '\\')",
    )
    const like = `%${likeEscape(query.search)}%`
    params.push(like, like, like)
  }
  if (query.category) {
    clauses.push("category = ?")
    params.push(query.category)
  }
  if (query.continent) {
    clauses.push("continent = ?")
    params.push(query.continent)
  }
  if (query.status) {
    clauses.push("status = ?")
    params.push(query.status)
  }
  if (query.featured !== undefined) {
    clauses.push("featured = ?")
    params.push(query.featured ? 1 : 0)
  }
  return { clauses, params }
}

export function listMarkets(query) {
  const database = getDb()
  const { clauses, params } = marketFilterClauses(query)
  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : ""
  const total =
    one(
      database.prepare(`SELECT COUNT(*) AS n FROM markets ${where}`),
      ...params,
    )?.n ?? 0
  const limit = query.limit ?? 24
  const offset = query.offset ?? 0
  const rows = database
    .prepare(
      `SELECT * FROM markets ${where} ORDER BY trending_score DESC LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset)
  return {
    markets: rows.map((row) => fullMarket(database, row)),
    total,
    limit,
    offset,
  }
}

export function getMarketByIdOrSlug(idOrSlug) {
  const database = getDb()
  const row = one(
    database.prepare(
      "SELECT * FROM markets WHERE market_id = ? OR slug = ? LIMIT 1",
    ),
    idOrSlug,
    idOrSlug,
  )
  return fullMarket(database, row)
}

export function listMarketsByContinent(continent, query = {}) {
  return listMarkets({ ...query, continent })
}

export function updateMarketStatus(marketDocId, status, outcome) {
  const sets = ["status=?"]
  const params = [status]
  if (outcome !== undefined) {
    sets.push("outcome=?")
    params.push(outcome)
  }
  params.push(marketDocId)
  getDb()
    .prepare(`UPDATE markets SET ${sets.join(", ")} WHERE market_id=?`)
    .run(...params)
}

/**
 * Overwrite a market's pool display fields (boost reconciliation, drift
 * repair). Unlike incrementActivity this sets absolute values — callers
 * pass chain-verified totals.
 */
export function updateMarketPools(
  marketDocId,
  { yesPrice, noPrice, yesLiquidity, noLiquidity, totalVolume },
) {
  getDb()
    .prepare(
      `UPDATE markets SET yes_price=?, no_price=?, yes_liquidity=?,
       no_liquidity=?, total_volume=? WHERE market_id=?`,
    )
    .run(yesPrice, noPrice, yesLiquidity, noLiquidity, totalVolume, marketDocId)
}

/** Lean pool read for every open market (boost planning). */
export function listOpenMarketPools() {
  return getDb()
    .prepare(
      `SELECT market_id, onchain_market_id, yes_liquidity, no_liquidity
       FROM markets WHERE status='open' ORDER BY onchain_market_id ASC`,
    )
    .all()
    .map((row) => ({
      marketDocId: row.market_id,
      onchainMarketId: row.onchain_market_id,
      yesLiquidity: row.yes_liquidity,
      noLiquidity: row.no_liquidity,
    }))
}

/** Append entries to a market's embedded recent-trades list (cap 8). */
export function appendRecentTrades(marketDocId, trades) {
  const database = getDb()
  const row = one(
    database.prepare(
      "SELECT recent_trades_json FROM markets WHERE market_id = ?",
    ),
    marketDocId,
  )
  if (!row) return
  let existing = []
  try {
    existing = JSON.parse(row.recent_trades_json || "[]")
    if (!Array.isArray(existing)) existing = []
  } catch {
    existing = []
  }
  const merged = [...existing, ...trades].slice(-8)
  database
    .prepare("UPDATE markets SET recent_trades_json=? WHERE market_id=?")
    .run(JSON.stringify(merged), marketDocId)
}

export function appendHistoryPoint(marketDocId, point) {
  const database = getDb()
  const row = one(
    database.prepare("SELECT id FROM markets WHERE market_id = ?"),
    marketDocId,
  )
  if (!row) return
  database
    .prepare(
      `INSERT INTO market_history
       (market_id, timestamp, yes_probability, no_probability, total_volume, yes_liquidity, no_liquidity)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      row.id,
      point.timestamp,
      point.yesProbability,
      point.noProbability,
      point.totalVolume,
      point.yesLiquidity,
      point.noLiquidity,
    )
  database
    .prepare(
      `DELETE FROM market_history WHERE market_id = ? AND id NOT IN
       (SELECT id FROM market_history WHERE market_id = ? ORDER BY timestamp DESC, id DESC LIMIT ?)`,
    )
    .run(row.id, row.id, HISTORY_CAP)
}

export function incrementActivity(marketDocId, amountSol, walletAddress) {
  const database = getDb()
  const row = one(
    database.prepare(
      "SELECT id, total_volume FROM markets WHERE market_id = ?",
    ),
    marketDocId,
  )
  if (!row) return null
  database
    .prepare("UPDATE markets SET total_volume = total_volume + ? WHERE id = ?")
    .run(amountSol, row.id)
  database
    .prepare(
      "INSERT OR IGNORE INTO market_participants (market_id, wallet) VALUES (?, ?)",
    )
    .run(row.id, walletAddress)
  const count = database
    .prepare(
      "SELECT COUNT(*) AS n FROM market_participants WHERE market_id = ?",
    )
    .get(row.id)
  return { participants: count?.n ?? 0 }
}

export function seedParticipants(marketDocId, wallets) {
  const database = getDb()
  const row = one(
    database.prepare("SELECT id FROM markets WHERE market_id = ?"),
    marketDocId,
  )
  if (!row) return 0
  const stmt = database.prepare(
    "INSERT OR IGNORE INTO market_participants (market_id, wallet) VALUES (?, ?)",
  )
  let added = 0
  for (const wallet of wallets) {
    const info = stmt.run(row.id, wallet)
    added += Number(info.changes)
  }
  return added
}

export function getRowIdByMarketId(marketDocId) {
  const row = one(
    getDb().prepare("SELECT id FROM markets WHERE market_id = ?"),
    marketDocId,
  )
  return row ? row.id : null
}

/** Returns the subset of ids present in the markets table (single query). */
export function existingMarketIds(marketDocIds) {
  const unique = [...new Set(marketDocIds.filter(Boolean))]
  if (unique.length === 0) return []
  const placeholders = unique.map(() => "?").join(",")
  return getDb()
    .prepare(
      `SELECT market_id FROM markets WHERE market_id IN (${placeholders})`,
    )
    .all(...unique)
    .map((row) => row.market_id)
}

export function countOpenMarkets() {
  return (
    getDb()
      .prepare("SELECT COUNT(*) AS n FROM markets WHERE status='open'")
      .get()?.n ?? 0
  )
}

export function maxOnchainMarketId() {
  return (
    getDb().prepare("SELECT MAX(onchain_market_id) AS m FROM markets").get()
      ?.m ?? null
  )
}

export function dueToClose(nowIso) {
  return getDb()
    .prepare(
      "SELECT market_id, onchain_market_id, question FROM markets WHERE status='open' AND closes_at <= ?",
    )
    .all(nowIso)
}

export function dueToResolve(nowIso) {
  const database = getDb()
  return database
    .prepare("SELECT * FROM markets WHERE status='closed' AND resolves_at <= ?")
    .all(nowIso)
    .map((row) => fullMarket(database, row))
}

// --- positions --------------------------------------------------------------

export function insertPosition(params) {
  const database = getDb()
  const user = getUserByWallet(params.walletAddress)
  const marketRowId = params.marketDocId
    ? (one(
        database.prepare("SELECT id FROM markets WHERE market_id = ?"),
        params.marketDocId,
      )?.id ?? null)
    : null
  const id = `${params.marketDocId}:${params.side}:${params.txSignature ?? Date.now()}`
  const now = new Date().toISOString()
  database
    .prepare(
      `INSERT INTO positions (id, user_id, wallet_address, market_row_id, market_doc_id,
       onchain_market_id, market_question, side, amount_sol, amount_lamports,
       estimated_payout_sol, estimated_payout_lamports, status, tx_signature, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)`,
    )
    .run(
      id,
      user ? Number(user._id) : null,
      params.walletAddress,
      marketRowId,
      params.marketDocId,
      params.onchainMarketId,
      params.marketQuestion,
      params.side,
      params.amountSol,
      params.amountLamports,
      params.estimatedPayoutSol,
      params.estimatedPayoutLamports,
      params.txSignature ?? null,
      now,
    )
  return getPositionById(id)
}

export function getPositionById(id) {
  const row = one(getDb().prepare("SELECT * FROM positions WHERE id = ?"), id)
  return row ? positionRow(row) : null
}

function positionRow(row) {
  return {
    _id: row.id,
    userId: row.user_id != null ? String(row.user_id) : undefined,
    walletAddress: row.wallet_address,
    marketId: row.market_row_id != null ? String(row.market_row_id) : undefined,
    marketDocId: row.market_doc_id,
    onchainMarketId: row.onchain_market_id,
    marketQuestion: row.market_question,
    side: row.side,
    amountSol: row.amount_sol,
    amountLamports: row.amount_lamports,
    estimatedPayoutSol: row.estimated_payout_sol,
    estimatedPayoutLamports: row.estimated_payout_lamports,
    status: row.status,
    txSignature: row.tx_signature ?? undefined,
    createdAt: new Date(row.created_at),
    settledAt: row.settled_at ? new Date(row.settled_at) : undefined,
  }
}

export function listPositionsByWallet(walletAddress) {
  return getDb()
    .prepare(
      "SELECT * FROM positions WHERE wallet_address = ? ORDER BY created_at DESC",
    )
    .all(walletAddress)
    .map(positionRow)
}

export function updatePositionStatusById(id, status, txSignature) {
  const sets = ["status=?", "settled_at=?"]
  const params = [status, new Date().toISOString()]
  if (txSignature) {
    sets.push("tx_signature=?")
    params.push(txSignature)
  }
  params.push(id)
  getDb()
    .prepare(`UPDATE positions SET ${sets.join(", ")} WHERE id=?`)
    .run(...params)
}

export function settlePositionsByMarket(marketDocId, winningSide) {
  const database = getDb()
  const now = new Date().toISOString()
  const won = database
    .prepare(
      "UPDATE positions SET status='won', settled_at=? WHERE market_doc_id=? AND status='open' AND side=?",
    )
    .run(now, marketDocId, winningSide)
  const lostSide = winningSide === "yes" ? "no" : "yes"
  const lost = database
    .prepare(
      "UPDATE positions SET status='lost', settled_at=? WHERE market_doc_id=? AND status='open' AND side=?",
    )
    .run(now, marketDocId, lostSide)
  return { won: Number(won.changes), lost: Number(lost.changes) }
}

// --- transactions -----------------------------------------------------------

export function insertTransaction(params) {
  const database = getDb()
  const user = params.walletAddress
    ? getUserByWallet(params.walletAddress)
    : null
  const now = new Date().toISOString()
  const info = database
    .prepare(
      `INSERT OR IGNORE INTO transactions (user_id, wallet_address, type, chain, token,
       amount_sol, amount_lamports, tx_signature, status, related_market_id, market_doc_id,
       onchain_market_id, created_at, confirmed_at, failure_reason)
       VALUES (?, ?, ?, 'solana', 'SOL', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      user ? Number(user._id) : null,
      params.walletAddress,
      params.type,
      params.amountSol ?? null,
      params.amountLamports ?? null,
      params.txSignature,
      params.status,
      params.marketRowId ?? null,
      params.marketDocId ?? null,
      params.onchainMarketId ?? null,
      now,
      params.status === "confirmed" ? now : null,
      params.failureReason ?? null,
    )
  const found = one(
    database.prepare("SELECT * FROM transactions WHERE tx_signature = ?"),
    params.txSignature,
  )
  if (!found) throw new Error("insertTransaction: row missing after write")
  return { doc: transactionRow(found), inserted: Number(info.changes) === 1 }
}

function transactionRow(row) {
  return {
    _id: String(row.id),
    userId: row.user_id != null ? String(row.user_id) : undefined,
    walletAddress: row.wallet_address,
    type: row.type,
    chain: "solana",
    token: "SOL",
    amountSol: row.amount_sol ?? undefined,
    amountLamports: row.amount_lamports ?? undefined,
    txSignature: row.tx_signature,
    status: row.status,
    relatedMarketId:
      row.related_market_id != null ? String(row.related_market_id) : undefined,
    marketDocId: row.market_doc_id ?? undefined,
    onchainMarketId: row.onchain_market_id ?? undefined,
    createdAt: new Date(row.created_at),
    confirmedAt: row.confirmed_at ? new Date(row.confirmed_at) : undefined,
    failureReason: row.failure_reason ?? undefined,
  }
}

export function findTransactionBySignature(txSignature) {
  const row = one(
    getDb().prepare("SELECT * FROM transactions WHERE tx_signature = ?"),
    txSignature,
  )
  return row ? transactionRow(row) : null
}

export function listActivityByWallet(walletAddress) {
  return getDb()
    .prepare(
      "SELECT * FROM transactions WHERE wallet_address = ? ORDER BY created_at DESC LIMIT 50",
    )
    .all(walletAddress)
    .map(transactionRow)
}

// --- prices -----------------------------------------------------------------

export function insertPriceSnapshot(params) {
  const database = getDb()
  const marketRowId =
    params.marketRowId ?? getRowIdByMarketId(params.marketDocId)
  const info = database
    .prepare(
      `INSERT INTO market_prices (market_id, timestamp, yes_price, no_price, volume,
       trigger_event, yes_liquidity, no_liquidity, total_volume)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      marketRowId,
      params.timestamp ?? new Date().toISOString(),
      params.yesPrice,
      params.noPrice,
      params.volume,
      params.triggerEvent,
      params.yesLiquidity ?? null,
      params.noLiquidity ?? null,
      params.totalVolume ?? null,
    )
  return Number(info.lastInsertRowid)
}

/** Replace a market's embedded history (seeding). Live trades append. */
export function replaceHistory(marketDocId, points) {
  const database = getDb()
  const row = one(
    database.prepare("SELECT id FROM markets WHERE market_id = ?"),
    marketDocId,
  )
  if (!row) return
  database.prepare("DELETE FROM market_history WHERE market_id = ?").run(row.id)
  const stmt = database.prepare(
    `INSERT INTO market_history
     (market_id, timestamp, yes_probability, no_probability, total_volume, yes_liquidity, no_liquidity)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
  for (const p of points) {
    stmt.run(
      row.id,
      p.timestamp,
      p.yesProbability,
      p.noProbability,
      p.totalVolume,
      p.yesLiquidity,
      p.noLiquidity,
    )
  }
}

export function listPriceSnapshots(marketRowId) {
  return getDb()
    .prepare(
      "SELECT * FROM market_prices WHERE market_id = ? ORDER BY timestamp ASC, id ASC",
    )
    .all(marketRowId)
    .map((row) => ({
      timestamp: row.timestamp,
      yesPrice: row.yes_price,
      noPrice: row.no_price,
      volume: row.volume,
      yesLiquidity: row.yes_liquidity,
      noLiquidity: row.no_liquidity,
      totalVolume: row.total_volume,
    }))
}

export function deleteCreationSnapshots(marketRowId) {
  getDb()
    .prepare(
      "DELETE FROM market_prices WHERE market_id = ? AND trigger_event = 'creation'",
    )
    .run(marketRowId)
}

/** Replace a market's creation snapshots (seeding). Live trade snapshots stay. */
export function replaceCreationSnapshots(marketDocId, points) {
  const database = getDb()
  const row = one(
    database.prepare("SELECT id FROM markets WHERE market_id = ?"),
    marketDocId,
  )
  if (!row) return
  database
    .prepare(
      "DELETE FROM market_prices WHERE market_id = ? AND trigger_event = 'creation'",
    )
    .run(row.id)
  const stmt = database.prepare(
    `INSERT INTO market_prices (market_id, timestamp, yes_price, no_price, volume,
     trigger_event, yes_liquidity, no_liquidity, total_volume)
     VALUES (?, ?, ?, ?, ?, 'creation', ?, ?, ?)`,
  )
  for (const p of points) {
    stmt.run(
      row.id,
      p.timestamp,
      p.yesProbability,
      p.noProbability,
      p.totalVolume,
      p.yesLiquidity ?? null,
      p.noLiquidity ?? null,
      p.totalVolume,
    )
  }
}

// --- resolutions ------------------------------------------------------------

export function insertResolution(params) {
  const database = getDb()
  const marketRowId =
    one(
      database.prepare("SELECT id FROM markets WHERE market_id = ?"),
      params.marketDocId,
    )?.id ?? null
  const now = new Date().toISOString()
  const info = database
    .prepare(
      `INSERT INTO resolutions (market_id, market_doc_id, data_source, resolved_outcome,
       resolver_type, resolver_wallet, proof_url, resolved_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      marketRowId,
      params.marketDocId,
      "solana-program",
      params.resolvedOutcome,
      params.resolverType,
      params.resolverWallet,
      params.proofUrl ?? null,
      now,
    )
  return {
    _id: String(info.lastInsertRowid),
    marketId: marketRowId != null ? String(marketRowId) : "",
    marketDocId: params.marketDocId,
    dataSource: "solana-program",
    resolvedOutcome: params.resolvedOutcome,
    resolverType: params.resolverType,
    resolverWallet: params.resolverWallet,
    proofUrl: params.proofUrl,
    resolvedAt: new Date(now),
  }
}

// --- auth challenges ----------------------------------------------------------

export function insertChallenge(walletAddress, nonce, ttlMs) {
  const now = new Date()
  const info = getDb()
    .prepare(
      "INSERT INTO auth_challenges (wallet_address, nonce, created_at, expires_at, used) VALUES (?, ?, ?, ?, 0)",
    )
    .run(
      walletAddress,
      nonce,
      now.toISOString(),
      new Date(now.getTime() + ttlMs).toISOString(),
    )
  return {
    _id: String(info.lastInsertRowid),
    walletAddress,
    nonce,
    createdAt: now,
    expiresAt: new Date(now.getTime() + ttlMs),
    used: false,
  }
}

export function getChallenge(walletAddress, nonce) {
  const row = one(
    getDb().prepare(
      "SELECT * FROM auth_challenges WHERE wallet_address = ? AND nonce = ? LIMIT 1",
    ),
    walletAddress,
    nonce,
  )
  if (!row) return null
  return {
    _id: String(row.id),
    walletAddress: row.wallet_address,
    nonce: row.nonce,
    createdAt: new Date(row.created_at),
    expiresAt: new Date(row.expires_at),
    used: row.used === 1,
  }
}

export function markChallengeUsed(id) {
  getDb()
    .prepare("UPDATE auth_challenges SET used = 1 WHERE id = ?")
    .run(Number(id))
}

export function sweepExpiredChallenges() {
  getDb()
    .prepare("DELETE FROM auth_challenges WHERE expires_at <= ?")
    .run(new Date().toISOString())
}

// --- reset (seed --reset) -----------------------------------------------------

export function resetMarketData() {
  const database = getDb()
  database.exec(
    "DELETE FROM market_prices; DELETE FROM market_participants; DELETE FROM market_history; " +
      "DELETE FROM positions; DELETE FROM transactions; DELETE FROM resolutions; DELETE FROM markets;",
  )
}
