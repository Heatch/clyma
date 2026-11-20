// Types for ./store.mjs (plain-JS SQLite/D1 data layer). Kept in sync manually.
//
// Every table function is async: the local node:sqlite driver resolves
// synchronously, the D1 drivers resolve over the network.

import type { MarketHistoryPoint } from "@/lib/markets/types"

export interface StoreDriver {
  kind: string
  exec(sql: string): Promise<void>
  run(
    sql: string,
    params?: unknown[],
  ): Promise<{ changes: number; lastInsertRowid: number | bigint | null }>
  all(sql: string, params?: unknown[]): Promise<Array<Record<string, unknown>>>
  get(
    sql: string,
    params?: unknown[],
  ): Promise<Record<string, unknown> | undefined>
  batch(
    statements: Array<{ sql: string; params?: unknown[] }>,
  ): Promise<Array<{ rows: Array<Record<string, unknown>> }>>
  close(): Promise<void>
}

export function openStore(path?: string): Promise<StoreDriver>
export function openD1Store(binding: unknown): Promise<StoreDriver>
export function openHttpStore(config: {
  accountId: string
  databaseId: string
  apiToken: string
  baseUrl?: string
}): Promise<StoreDriver>
export function closeStore(): Promise<void>
export function storeKind(): string | null
export function __resetStoreForTests(): Promise<void>

export interface StoreUser {
  _id: string
  walletAddress: string
  username?: string
  createdAt: Date
  lastLoginAt: Date
}

export interface StoreMarketListQuery {
  search?: string
  category?: string
  continent?: string
  status?: string
  featured?: boolean
  limit?: number
  offset?: number
}

export function upsertUser(walletAddress: string): Promise<StoreUser>
export function getUserByWallet(
  walletAddress: string,
): Promise<StoreUser | null>

export function upsertMarket(
  doc: Record<string, unknown>,
): Promise<Record<string, unknown> | null>
export function listMarkets(query: StoreMarketListQuery): Promise<{
  markets: Array<Record<string, unknown>>
  total: number
  limit: number
  offset: number
}>
export function getMarketByIdOrSlug(
  idOrSlug: string,
): Promise<Record<string, unknown> | null>
export function listMarketsByContinent(
  continent: string,
  query?: Partial<StoreMarketListQuery>,
): Promise<{
  markets: Array<Record<string, unknown>>
  total: number
  limit: number
  offset: number
}>
export function updateMarketStatus(
  marketDocId: string,
  status: string,
  outcome?: string,
): Promise<void>
export function updateMarketPools(
  marketDocId: string,
  pools: {
    yesPrice: number
    noPrice: number
    yesLiquidity: number
    noLiquidity: number
    totalVolume: number
  },
): Promise<void>
export function listOpenMarketPools(): Promise<
  Array<{
    marketDocId: string
    onchainMarketId: number
    yesLiquidity: number
    noLiquidity: number
  }>
>
export function appendRecentTrades(
  marketDocId: string,
  trades: Array<Record<string, unknown>>,
): Promise<void>
export function appendHistoryPoint(
  marketDocId: string,
  point: MarketHistoryPoint,
): Promise<void>
export function incrementActivity(
  marketDocId: string,
  amountSol: number,
  walletAddress: string,
): Promise<{ participants: number } | null>
export function seedParticipants(
  marketDocId: string,
  wallets: string[],
): Promise<number>
export function getRowIdByMarketId(marketDocId: string): Promise<number | null>
export function existingMarketIds(marketDocIds: string[]): Promise<string[]>
export function marketPoolsByDocIds(
  marketDocIds: string[],
): Promise<Map<string, { yesLiquidity: number; noLiquidity: number }>>
export function countOpenMarkets(): Promise<number>
export function maxOnchainMarketId(): Promise<number | null>
export function dueToClose(
  nowIso: string,
): Promise<Array<Record<string, unknown>>>
export function dueToResolve(
  nowIso: string,
): Promise<Array<Record<string, unknown>>>

export function insertPosition(
  params: Record<string, unknown>,
): Promise<Record<string, unknown> | null>
export function getPositionById(
  id: string,
): Promise<Record<string, unknown> | null>
export function listPositionsByWallet(
  walletAddress: string,
): Promise<Array<Record<string, unknown>>>
export function updatePositionStatusById(
  id: string,
  status: string,
  txSignature?: string,
): Promise<void>
export function settlePositionsByMarket(
  marketDocId: string,
  winningSide: string,
): Promise<{ won: number; lost: number }>

export function insertTransaction(params: Record<string, unknown>): Promise<{
  doc: Record<string, unknown>
  inserted: boolean
}>
export function findTransactionBySignature(
  txSignature: string,
): Promise<Record<string, unknown> | null>
export function listActivityByWallet(
  walletAddress: string,
): Promise<Array<Record<string, unknown>>>

export function insertPriceSnapshot(
  params: Record<string, unknown>,
): Promise<number>
export function replaceHistory(
  marketDocId: string,
  points: MarketHistoryPoint[],
): Promise<void>
export function replaceCreationSnapshots(
  marketDocId: string,
  points: MarketHistoryPoint[],
): Promise<void>
export function listPriceSnapshots(
  marketRowId: number,
): Promise<Array<Record<string, unknown>>>
export function deleteCreationSnapshots(marketRowId: number): Promise<void>

export function insertResolution(
  params: Record<string, unknown>,
): Promise<Record<string, unknown>>

export function insertChallenge(
  walletAddress: string,
  nonce: string,
  ttlMs: number,
): Promise<Record<string, unknown>>
export function getChallenge(
  walletAddress: string,
  nonce: string,
): Promise<Record<string, unknown> | null>
export function markChallengeUsed(id: string): Promise<void>
export function sweepExpiredChallenges(): Promise<void>

export function resetMarketData(): Promise<void>
