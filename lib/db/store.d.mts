// Types for ./store.mjs (plain-JS SQLite layer). Kept in sync manually.

import type { MarketHistoryPoint } from "@/lib/markets/types"

export function openStore(path?: string): unknown
export function __resetStoreForTests(): void

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

export function upsertUser(walletAddress: string): StoreUser
export function getUserByWallet(walletAddress: string): StoreUser | null

export function upsertMarket(
  doc: Record<string, unknown>,
): Record<string, unknown>
export function listMarkets(query: StoreMarketListQuery): {
  markets: Array<Record<string, unknown>>
  total: number
  limit: number
  offset: number
}
export function getMarketByIdOrSlug(
  idOrSlug: string,
): Record<string, unknown> | null
export function listMarketsByContinent(
  continent: string,
  query?: Partial<StoreMarketListQuery>,
): {
  markets: Array<Record<string, unknown>>
  total: number
  limit: number
  offset: number
}
export function updateMarketStatus(
  marketDocId: string,
  status: string,
  outcome?: string,
): void
export function updateMarketPools(
  marketDocId: string,
  pools: {
    yesPrice: number
    noPrice: number
    yesLiquidity: number
    noLiquidity: number
    totalVolume: number
  },
): void
export function listOpenMarketPools(): Array<{
  marketDocId: string
  onchainMarketId: number
  yesLiquidity: number
  noLiquidity: number
}>
export function appendRecentTrades(
  marketDocId: string,
  trades: Array<Record<string, unknown>>,
): void
export function appendHistoryPoint(
  marketDocId: string,
  point: MarketHistoryPoint,
): void
export function incrementActivity(
  marketDocId: string,
  amountSol: number,
  walletAddress: string,
): { participants: number } | null
export function seedParticipants(marketDocId: string, wallets: string[]): number
export function getRowIdByMarketId(marketDocId: string): number | null
export function existingMarketIds(marketDocIds: string[]): string[]
export function marketPoolsByDocIds(
  marketDocIds: string[],
): Map<string, { yesLiquidity: number; noLiquidity: number }>
export function countOpenMarkets(): number
export function maxOnchainMarketId(): number | null
export function dueToClose(nowIso: string): Array<Record<string, unknown>>
export function dueToResolve(nowIso: string): Array<Record<string, unknown>>

export function insertPosition(
  params: Record<string, unknown>,
): Record<string, unknown>
export function getPositionById(id: string): Record<string, unknown> | null
export function listPositionsByWallet(
  walletAddress: string,
): Array<Record<string, unknown>>
export function updatePositionStatusById(
  id: string,
  status: string,
  txSignature?: string,
): void
export function settlePositionsByMarket(
  marketDocId: string,
  winningSide: string,
): { won: number; lost: number }

export function insertTransaction(params: Record<string, unknown>): {
  doc: Record<string, unknown>
  inserted: boolean
}
export function findTransactionBySignature(
  txSignature: string,
): Record<string, unknown> | null
export function listActivityByWallet(
  walletAddress: string,
): Array<Record<string, unknown>>

export function insertPriceSnapshot(params: Record<string, unknown>): number
export function replaceHistory(
  marketDocId: string,
  points: MarketHistoryPoint[],
): void
export function replaceCreationSnapshots(
  marketDocId: string,
  points: MarketHistoryPoint[],
): void
export function listPriceSnapshots(
  marketRowId: number,
): Array<Record<string, unknown>>
export function deleteCreationSnapshots(marketRowId: number): void

export function insertResolution(
  params: Record<string, unknown>,
): Record<string, unknown>

export function insertChallenge(
  walletAddress: string,
  nonce: string,
  ttlMs: number,
): Record<string, unknown>
export function getChallenge(
  walletAddress: string,
  nonce: string,
): Record<string, unknown> | null
export function markChallengeUsed(id: string): void
export function sweepExpiredChallenges(): void

export function resetMarketData(): void
