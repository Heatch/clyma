import { getDb } from "./connection"

export async function getUsersCollection() {
  const db = await getDb()
  return db.collection("users")
}

export async function getMarketsCollection() {
  const db = await getDb()
  return db.collection("markets")
}

export async function getPositionsCollection() {
  const db = await getDb()
  return db.collection("positions")
}

export async function getTransactionsCollection() {
  const db = await getDb()
  return db.collection("transactions")
}

export async function getResolutionsCollection() {
  const db = await getDb()
  return db.collection("resolutions")
}

export async function getMarketPricesCollection() {
  const db = await getDb()
  return db.collection("market_prices")
}

export async function getAuthChallengesCollection() {
  const db = await getDb()
  return db.collection("auth_challenges")
}

export async function ensureIndexes() {
  const db = await getDb()

  await db.collection("users").createIndex({ walletAddress: 1 }, { unique: true })

  await db.collection("markets").createIndex({ status: 1 })
  await db.collection("markets").createIndex({ category: 1 })
  await db.collection("markets").createIndex({ closesAt: 1 })
  await db.collection("markets").createIndex({ onchainMarketId: 1 }, { unique: true, sparse: true })

  await db.collection("positions").createIndex({ userId: 1 })
  await db.collection("positions").createIndex({ marketId: 1 })
  await db.collection("positions").createIndex({ marketId: 1, status: 1 })
  await db.collection("positions").createIndex({ walletAddress: 1 })

  await db.collection("transactions").createIndex({ txSignature: 1 }, { unique: true, sparse: true })
  await db.collection("transactions").createIndex({ userId: 1 })
  await db.collection("transactions").createIndex({ status: 1 })

  await db.collection("resolutions").createIndex({ marketId: 1 }, { unique: true })

  await db.collection("market_prices").createIndex({ marketId: 1, timestamp: 1 })

  await db.collection("auth_challenges").createIndex({ walletAddress: 1 })
  await db.collection("auth_challenges").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 })
}
