// lib/db/store.mjs — single data layer for the app AND scripts.
//
// Driver-agnostic and async: the same SQL runs on node:sqlite locally
// (dev, tests, CLI scripts) and on Cloudflare D1 in production (Workers
// binding, or the D1 HTTP API from scripts). Both the TypeScript
// repositories and scripts/*.mjs import this module, so there is exactly
// one place that speaks SQL.
//
// Row objects are shaped like the TS doc types (camelCase, Date instances,
// string ids).

import { HISTORY_CAP } from "./schema.mjs"

const MAX_BOUND_PARAMS = 90

let driver = null
let driverKey = null

// --- opening the store -------------------------------------------------------

/**
 * Opens the local SQLite driver (node:sqlite). Used by `next dev`, the
 * vitest suite, and CLI scripts when no D1 credentials are configured.
 */
export async function openStore(path) {
  const { createNodeDriver, defaultSqlitePath } =
    await import("./drivers/node-sqlite.mjs")
  const target = path ?? process.env.SQLITE_PATH ?? defaultSqlitePath()
  if (driver && driverKey === target) return driver
  await closeStore()
  driver = await createNodeDriver(target)
  driverKey = target
  return driver
}

/** Opens the Cloudflare D1 binding driver (Workers runtime). */
export async function openD1Store(binding) {
  if (!binding) throw new Error("openD1Store: D1 binding is missing")
  const key = "d1"
  if (driver && driverKey === key) return driver
  const { createD1Driver } = await import("./drivers/d1.mjs")
  await closeStore()
  driver = await createD1Driver(binding)
  driverKey = key
  return driver
}

/** Opens the D1 REST driver (CLI scripts against the deployed database). */
export async function openHttpStore(config) {
  const key = `d1-http:${config.databaseId}`
  if (driver && driverKey === key) return driver
  const { createD1HttpDriver } = await import("./drivers/d1-http.mjs")
  await closeStore()
  driver = await createD1HttpDriver(config)
  driverKey = key
  return driver
}

export async function closeStore() {
  if (driver) {
    try {
      await driver.close()
    } catch {}
  }
  driver = null
  driverKey = null
}

/** Test hook: close + forget the singleton so the next open starts fresh. */
export async function __resetStoreForTests() {
  await closeStore()
}

export function storeKind() {
  return driver?.kind ?? null
}

async function getDriver() {
  if (driver) return driver
  return openStore()
}

/** Single-row read normalized so "no matching row" is always undefined. */
async function one(database, sql, params = []) {
  const row = await database.get(sql, params)
  if (row === undefined || row === null) return undefined
  if (
    typeof row === "object" &&
    Object.values(row).every((value) => value == null)
  ) {
    return undefined
  }
  return row
}

function chunk(values, size) {
  const out = []
  for (let i = 0; i < values.length; i += size) {
    out.push(values.slice(i, i + size))
  }
  return out
}

function placeholders(count) {
  return Array.from({ length: count }, () => "?").join(",")
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

/**
 * Attaches `history` and `participants` to a page of markets with two
 * chunked queries instead of two queries per market (D1 counts every one).
 */
async function hydrate(database, rows) {
  if (!rows || rows.length === 0) return []
  const ids = rows.map((row) => row.id)
  const historyByMarket = new Map()
  const participantsByMarket = new Map()

  for (const part of chunk(ids, MAX_BOUND_PARAMS)) {
    const marks = placeholders(part.length)
    const [historyResult, participantsResult] = await database.batch([
      {
        sql: `SELECT * FROM market_history WHERE market_id IN (${marks}) ORDER BY timestamp ASC, id ASC`,
        params: part,
      },
      {
        sql: `SELECT market_id, COUNT(*) AS n FROM market_participants WHERE market_id IN (${marks}) GROUP BY market_id`,
        params: part,
      },
    ])
    for (const row of historyResult.rows) {
      const list = historyByMarket.get(row.market_id) ?? []
      list.push(historyRow(row))
      historyByMarket.set(row.market_id, list)
    }
    for (const row of participantsResult.rows) {
      participantsByMarket.set(row.market_id, row.n ?? 0)
    }
  }

  return rows.map((row) => {
    const doc = marketRow(row)
    if (!doc) return null
    doc.history = historyByMarket.get(row.id) ?? []
    doc.participants = participantsByMarket.get(row.id) ?? 0
    return doc
  })
}

function bool(v) {
  return v ? 1 : 0
}

// --- users ------------------------------------------------------------------

export async function upsertUser(walletAddress) {
  const database = await getDriver()
  const now = new Date().toISOString()
  await database.run(
    `INSERT INTO users (wallet_address, created_at, last_login_at)
     VALUES (?, ?, ?)
     ON CONFLICT(wallet_address) DO UPDATE SET last_login_at = excluded.last_login_at`,
    [walletAddress, now, now],
  )
  return getUserByWallet(walletAddress)
}

export async function getUserByWallet(walletAddress) {
  const database = await getDriver()
  const row = await one(
    database,
    "SELECT * FROM users WHERE wallet_address = ?",
    [walletAddress],
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

export async function upsertMarket(doc) {
  const database = await getDriver()
  const existing = await one(
    database,
    "SELECT id FROM markets WHERE onchain_market_id = ?",
    [doc.onchainMarketId],
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
    await database.run(
      `UPDATE markets SET market_id=?, onchain_market_id=?, slug=?, title=?, question=?,
       description=?, category=?, continent=?, country=?, region=?, latitude=?, longitude=?,
       resolution_source=?, resolution_source_url=?, resolution_rules=?, status=?, outcome=?,
       yes_price=?, no_price=?, yes_liquidity=?, no_liquidity=?, total_volume=?,
       featured=?, trending_score=?, resolver=?, evidence_json=?, recent_trades_json=?,
       resolution_json=?, open_at=?, closes_at=?, resolves_at=?, created_at=?
       WHERE id=?`,
      [...params, existing.id],
    )
    const row = await one(database, "SELECT * FROM markets WHERE id=?", [
      existing.id,
    ])
    return (await hydrate(database, row ? [row] : []))[0] ?? null
  }
  const info = await database.run(
    `INSERT INTO markets (market_id, onchain_market_id, slug, title, question,
     description, category, continent, country, region, latitude, longitude,
     resolution_source, resolution_source_url, resolution_rules, status, outcome,
     yes_price, no_price, yes_liquidity, no_liquidity, total_volume,
     featured, trending_score, resolver, evidence_json, recent_trades_json,
     resolution_json, open_at, closes_at, resolves_at, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    params,
  )
  const row = await one(database, "SELECT * FROM markets WHERE id=?", [
    info.lastInsertRowid,
  ])
  return (await hydrate(database, row ? [row] : []))[0] ?? null
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

function likeEscape(value) {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`)
}

export async function listMarkets(query) {
  const database = await getDriver()
  const { clauses, params } = marketFilterClauses(query)
  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : ""
  const total =
    (await one(database, `SELECT COUNT(*) AS n FROM markets ${where}`, params))
      ?.n ?? 0
  const limit = query.limit ?? 24
  const offset = query.offset ?? 0
  const rows = await database.all(
    `SELECT * FROM markets ${where} ORDER BY trending_score DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  )
  return {
    markets: await hydrate(database, rows),
    total,
    limit,
    offset,
  }
}

export async function getMarketByIdOrSlug(idOrSlug) {
  const database = await getDriver()
  const row = await one(
    database,
    "SELECT * FROM markets WHERE market_id = ? OR slug = ? LIMIT 1",
    [idOrSlug, idOrSlug],
  )
  if (!row) return null
  return (await hydrate(database, [row]))[0] ?? null
}

export async function listMarketsByContinent(continent, query = {}) {
  return listMarkets({ ...query, continent })
}

export async function updateMarketStatus(marketDocId, status, outcome) {
  const sets = ["status=?"]
  const params = [status]
  if (outcome !== undefined) {
    sets.push("outcome=?")
    params.push(outcome)
  }
  params.push(marketDocId)
  const database = await getDriver()
  await database.run(
    `UPDATE markets SET ${sets.join(", ")} WHERE market_id=?`,
    params,
  )
}

/**
 * Overwrite a market's pool display fields (boost reconciliation, drift
 * repair). Unlike incrementActivity this sets absolute values — callers
 * pass chain-verified totals.
 */
export async function updateMarketPools(
  marketDocId,
  { yesPrice, noPrice, yesLiquidity, noLiquidity, totalVolume },
) {
  const database = await getDriver()
  await database.run(
    `UPDATE markets SET yes_price=?, no_price=?, yes_liquidity=?,
     no_liquidity=?, total_volume=? WHERE market_id=?`,
    [yesPrice, noPrice, yesLiquidity, noLiquidity, totalVolume, marketDocId],
  )
}

/** Lean pool read for every open market (boost planning). */
export async function listOpenMarketPools() {
  const database = await getDriver()
  const rows = await database.all(
    `SELECT market_id, onchain_market_id, yes_liquidity, no_liquidity
     FROM markets WHERE status='open' ORDER BY onchain_market_id ASC`,
  )
  return rows.map((row) => ({
    marketDocId: row.market_id,
    onchainMarketId: row.onchain_market_id,
    yesLiquidity: row.yes_liquidity,
    noLiquidity: row.no_liquidity,
  }))
}

/** Pool balances for a set of markets (position payout estimates). */
export async function marketPoolsByDocIds(marketDocIds) {
  const unique = [...new Set(marketDocIds.filter(Boolean))]
  if (unique.length === 0) return new Map()
  const database = await getDriver()
  const pools = new Map()
  for (const part of chunk(unique, MAX_BOUND_PARAMS)) {
    const rows = await database.all(
      `SELECT market_id, yes_liquidity, no_liquidity
       FROM markets WHERE market_id IN (${placeholders(part.length)})`,
      part,
    )
    for (const row of rows) {
      pools.set(row.market_id, {
        yesLiquidity: row.yes_liquidity,
        noLiquidity: row.no_liquidity,
      })
    }
  }
  return pools
}

/** Append entries to a market's embedded recent-trades list (cap 8). */
export async function appendRecentTrades(marketDocId, trades) {
  const database = await getDriver()
  const row = await one(
    database,
    "SELECT recent_trades_json FROM markets WHERE market_id = ?",
    [marketDocId],
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
  await database.run(
    "UPDATE markets SET recent_trades_json=? WHERE market_id=?",
    [JSON.stringify(merged), marketDocId],
  )
}

export async function appendHistoryPoint(marketDocId, point) {
  const database = await getDriver()
  const row = await one(
    database,
    "SELECT id FROM markets WHERE market_id = ?",
    [marketDocId],
  )
  if (!row) return
  await database.run(
    `INSERT INTO market_history
     (market_id, timestamp, yes_probability, no_probability, total_volume, yes_liquidity, no_liquidity)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      row.id,
      point.timestamp,
      point.yesProbability,
      point.noProbability,
      point.totalVolume,
      point.yesLiquidity,
      point.noLiquidity,
    ],
  )
  await database.run(
    `DELETE FROM market_history WHERE market_id = ? AND id NOT IN
     (SELECT id FROM market_history WHERE market_id = ? ORDER BY timestamp DESC, id DESC LIMIT ?)`,
    [row.id, row.id, HISTORY_CAP],
  )
}

export async function incrementActivity(marketDocId, amountSol, walletAddress) {
  const database = await getDriver()
  const row = await one(
    database,
    "SELECT id, total_volume FROM markets WHERE market_id = ?",
    [marketDocId],
  )
  if (!row) return null
  await database.run(
    "UPDATE markets SET total_volume = total_volume + ? WHERE id = ?",
    [amountSol, row.id],
  )
  await database.run(
    "INSERT OR IGNORE INTO market_participants (market_id, wallet) VALUES (?, ?)",
    [row.id, walletAddress],
  )
  const count = await one(
    database,
    "SELECT COUNT(*) AS n FROM market_participants WHERE market_id = ?",
    [row.id],
  )
  return { participants: count?.n ?? 0 }
}

export async function seedParticipants(marketDocId, wallets) {
  const database = await getDriver()
  const row = await one(
    database,
    "SELECT id FROM markets WHERE market_id = ?",
    [marketDocId],
  )
  if (!row) return 0
  let added = 0
  for (const wallet of wallets) {
    const info = await database.run(
      "INSERT OR IGNORE INTO market_participants (market_id, wallet) VALUES (?, ?)",
      [row.id, wallet],
    )
    added += Number(info.changes)
  }
  return added
}

export async function getRowIdByMarketId(marketDocId) {
  const database = await getDriver()
  const row = await one(
    database,
    "SELECT id FROM markets WHERE market_id = ?",
    [marketDocId],
  )
  return row ? row.id : null
}

/** Returns the subset of ids present in the markets table (chunked). */
export async function existingMarketIds(marketDocIds) {
  const unique = [...new Set(marketDocIds.filter(Boolean))]
  if (unique.length === 0) return []
  const database = await getDriver()
  const found = []
  for (const part of chunk(unique, MAX_BOUND_PARAMS)) {
    const rows = await database.all(
      `SELECT market_id FROM markets WHERE market_id IN (${placeholders(part.length)})`,
      part,
    )
    for (const row of rows) found.push(row.market_id)
  }
  return found
}

export async function countOpenMarkets() {
  const database = await getDriver()
  return (
    (
      await one(
        database,
        "SELECT COUNT(*) AS n FROM markets WHERE status='open'",
      )
    )?.n ?? 0
  )
}

export async function maxOnchainMarketId() {
  const database = await getDriver()
  return (
    (await one(database, "SELECT MAX(onchain_market_id) AS m FROM markets"))
      ?.m ?? null
  )
}

export async function dueToClose(nowIso) {
  const database = await getDriver()
  return database.all(
    "SELECT market_id, onchain_market_id, question FROM markets WHERE status='open' AND closes_at <= ?",
    [nowIso],
  )
}

export async function dueToResolve(nowIso) {
  const database = await getDriver()
  const rows = await database.all(
    "SELECT * FROM markets WHERE status='closed' AND resolves_at <= ?",
    [nowIso],
  )
  return hydrate(database, rows)
}

// --- positions --------------------------------------------------------------

export async function insertPosition(params) {
  const database = await getDriver()
  const user = await getUserByWallet(params.walletAddress)
  const marketRowId = params.marketDocId
    ? ((
        await one(database, "SELECT id FROM markets WHERE market_id = ?", [
          params.marketDocId,
        ])
      )?.id ?? null)
    : null
  const id = `${params.marketDocId}:${params.side}:${params.txSignature ?? Date.now()}`
  const now = new Date().toISOString()
  await database.run(
    `INSERT INTO positions (id, user_id, wallet_address, market_row_id, market_doc_id,
     onchain_market_id, market_question, side, amount_sol, amount_lamports,
     estimated_payout_sol, estimated_payout_lamports, status, tx_signature, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)`,
    [
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
    ],
  )
  return getPositionById(id)
}

export async function getPositionById(id) {
  const database = await getDriver()
  const row = await one(database, "SELECT * FROM positions WHERE id = ?", [id])
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

export async function listPositionsByWallet(walletAddress) {
  const database = await getDriver()
  const rows = await database.all(
    "SELECT * FROM positions WHERE wallet_address = ? ORDER BY created_at DESC",
    [walletAddress],
  )
  return rows.map(positionRow)
}

export async function updatePositionStatusById(id, status, txSignature) {
  const sets = ["status=?", "settled_at=?"]
  const params = [status, new Date().toISOString()]
  if (txSignature) {
    sets.push("tx_signature=?")
    params.push(txSignature)
  }
  params.push(id)
  const database = await getDriver()
  await database.run(
    `UPDATE positions SET ${sets.join(", ")} WHERE id=?`,
    params,
  )
}

export async function settlePositionsByMarket(marketDocId, winningSide) {
  const database = await getDriver()
  const now = new Date().toISOString()
  const won = await database.run(
    "UPDATE positions SET status='won', settled_at=? WHERE market_doc_id=? AND status='open' AND side=?",
    [now, marketDocId, winningSide],
  )
  const lostSide = winningSide === "yes" ? "no" : "yes"
  const lost = await database.run(
    "UPDATE positions SET status='lost', settled_at=? WHERE market_doc_id=? AND status='open' AND side=?",
    [now, marketDocId, lostSide],
  )
  return { won: Number(won.changes), lost: Number(lost.changes) }
}

// --- transactions -----------------------------------------------------------

export async function insertTransaction(params) {
  const database = await getDriver()
  const user = params.walletAddress
    ? await getUserByWallet(params.walletAddress)
    : null
  const now = new Date().toISOString()
  const info = await database.run(
    `INSERT OR IGNORE INTO transactions (user_id, wallet_address, type, chain, token,
     amount_sol, amount_lamports, tx_signature, status, related_market_id, market_doc_id,
     onchain_market_id, created_at, confirmed_at, failure_reason)
     VALUES (?, ?, ?, 'solana', 'SOL', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
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
    ],
  )
  const found = await one(
    database,
    "SELECT * FROM transactions WHERE tx_signature = ?",
    [params.txSignature],
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

export async function findTransactionBySignature(txSignature) {
  const database = await getDriver()
  const row = await one(
    database,
    "SELECT * FROM transactions WHERE tx_signature = ?",
    [txSignature],
  )
  return row ? transactionRow(row) : null
}

export async function listActivityByWallet(walletAddress) {
  const database = await getDriver()
  const rows = await database.all(
    "SELECT * FROM transactions WHERE wallet_address = ? ORDER BY created_at DESC LIMIT 50",
    [walletAddress],
  )
  return rows.map(transactionRow)
}

// --- prices -----------------------------------------------------------------

export async function insertPriceSnapshot(params) {
  const database = await getDriver()
  const marketRowId =
    params.marketRowId ?? (await getRowIdByMarketId(params.marketDocId))
  const info = await database.run(
    `INSERT INTO market_prices (market_id, timestamp, yes_price, no_price, volume,
     trigger_event, yes_liquidity, no_liquidity, total_volume)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      marketRowId,
      params.timestamp ?? new Date().toISOString(),
      params.yesPrice,
      params.noPrice,
      params.volume,
      params.triggerEvent,
      params.yesLiquidity ?? null,
      params.noLiquidity ?? null,
      params.totalVolume ?? null,
    ],
  )
  return Number(info.lastInsertRowid)
}

/** Replace a market's embedded history (seeding). Live trades append. */
export async function replaceHistory(marketDocId, points) {
  const database = await getDriver()
  const row = await one(
    database,
    "SELECT id FROM markets WHERE market_id = ?",
    [marketDocId],
  )
  if (!row) return
  await database.run("DELETE FROM market_history WHERE market_id = ?", [row.id])
  for (const p of points) {
    await database.run(
      `INSERT INTO market_history
       (market_id, timestamp, yes_probability, no_probability, total_volume, yes_liquidity, no_liquidity)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        row.id,
        p.timestamp,
        p.yesProbability,
        p.noProbability,
        p.totalVolume,
        p.yesLiquidity,
        p.noLiquidity,
      ],
    )
  }
}

export async function listPriceSnapshots(marketRowId) {
  const database = await getDriver()
  const rows = await database.all(
    "SELECT * FROM market_prices WHERE market_id = ? ORDER BY timestamp ASC, id ASC",
    [marketRowId],
  )
  return rows.map((row) => ({
    timestamp: row.timestamp,
    yesPrice: row.yes_price,
    noPrice: row.no_price,
    volume: row.volume,
    yesLiquidity: row.yes_liquidity,
    noLiquidity: row.no_liquidity,
    totalVolume: row.total_volume,
  }))
}

export async function deleteCreationSnapshots(marketRowId) {
  const database = await getDriver()
  await database.run(
    "DELETE FROM market_prices WHERE market_id = ? AND trigger_event = 'creation'",
    [marketRowId],
  )
}

/** Replace a market's creation snapshots (seeding). Live trade snapshots stay. */
export async function replaceCreationSnapshots(marketDocId, points) {
  const database = await getDriver()
  const row = await one(
    database,
    "SELECT id FROM markets WHERE market_id = ?",
    [marketDocId],
  )
  if (!row) return
  await database.run(
    "DELETE FROM market_prices WHERE market_id = ? AND trigger_event = 'creation'",
    [row.id],
  )
  for (const p of points) {
    await database.run(
      `INSERT INTO market_prices (market_id, timestamp, yes_price, no_price, volume,
       trigger_event, yes_liquidity, no_liquidity, total_volume)
       VALUES (?, ?, ?, ?, ?, 'creation', ?, ?, ?)`,
      [
        row.id,
        p.timestamp,
        p.yesProbability,
        p.noProbability,
        p.totalVolume,
        p.yesLiquidity ?? null,
        p.noLiquidity ?? null,
        p.totalVolume,
      ],
    )
  }
}

// --- resolutions ------------------------------------------------------------

export async function insertResolution(params) {
  const database = await getDriver()
  const marketRowId =
    (
      await one(database, "SELECT id FROM markets WHERE market_id = ?", [
        params.marketDocId,
      ])
    )?.id ?? null
  const now = new Date().toISOString()
  const info = await database.run(
    `INSERT INTO resolutions (market_id, market_doc_id, data_source, resolved_outcome,
     resolver_type, resolver_wallet, proof_url, resolved_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      marketRowId,
      params.marketDocId,
      "solana-program",
      params.resolvedOutcome,
      params.resolverType,
      params.resolverWallet,
      params.proofUrl ?? null,
      now,
    ],
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

export async function insertChallenge(walletAddress, nonce, ttlMs) {
  const now = new Date()
  const database = await getDriver()
  const info = await database.run(
    "INSERT INTO auth_challenges (wallet_address, nonce, created_at, expires_at, used) VALUES (?, ?, ?, ?, 0)",
    [
      walletAddress,
      nonce,
      now.toISOString(),
      new Date(now.getTime() + ttlMs).toISOString(),
    ],
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

export async function getChallenge(walletAddress, nonce) {
  const database = await getDriver()
  const row = await one(
    database,
    "SELECT * FROM auth_challenges WHERE wallet_address = ? AND nonce = ? LIMIT 1",
    [walletAddress, nonce],
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

export async function markChallengeUsed(id) {
  const database = await getDriver()
  await database.run("UPDATE auth_challenges SET used = 1 WHERE id = ?", [
    Number(id),
  ])
}

export async function sweepExpiredChallenges() {
  const database = await getDriver()
  await database.run("DELETE FROM auth_challenges WHERE expires_at <= ?", [
    new Date().toISOString(),
  ])
}

// --- reset (seed --reset) -----------------------------------------------------

export async function resetMarketData() {
  const database = await getDriver()
  await database.exec(
    "DELETE FROM market_prices; DELETE FROM market_participants; DELETE FROM market_history; " +
      "DELETE FROM positions; DELETE FROM transactions; DELETE FROM resolutions; DELETE FROM markets;",
  )
}
