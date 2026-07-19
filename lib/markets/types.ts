export const MARKET_CATEGORIES = [
  "hurricane",
  "drought",
  "temperature",
  "rainfall",
  "crop-yield",
  "wildfire",
  "flooding",
  "other",
] as const

export type MarketCategory = (typeof MARKET_CATEGORIES)[number]

export const MARKET_STATUSES = [
  "open",
  "closed",
  "resolved",
  "cancelled",
] as const

export type MarketStatus = (typeof MARKET_STATUSES)[number]

export const MARKET_OUTCOMES = ["unresolved", "yes", "no", "cancelled"] as const

export type MarketOutcome = (typeof MARKET_OUTCOMES)[number]

export const MARKET_CONTINENTS = [
  "North America",
  "South America",
  "Europe",
  "Africa",
  "Asia",
  "Oceania",
] as const

export type MarketContinent = (typeof MARKET_CONTINENTS)[number]

export type TradeSide = "yes" | "no"



export type MarketChainState =
  "demo-only" | "loading" | "synced" | "missing" | "error"

export interface MarketHistoryPoint {
  timestamp: string
  yesProbability: number
  noProbability: number
  totalVolume: number
  yesLiquidity: number
  noLiquidity: number
  dataLabel: string
}

export type EvidenceKind =
  | "forecast"
  | "observation"
  | "methodology"
  | "resolution-source"
  | "background"

export interface MarketEvidence {
  id: string
  title: string
  summary: string
  publisher: string
  url: string
  publishedAt: string
  kind: EvidenceKind
  isDemo: boolean
}

export interface MarketTrade {
  id: string
  marketId: string
  side: TradeSide
  amountSol: number
  amountLamports: string
  probability: number
  estimatedPayoutSol: number
  wallet: string
  timestamp: string
  transactionSignature?: string
  isDemo: boolean
}

export interface MarketResolution {
  outcome: Exclude<MarketOutcome, "unresolved">
  resolvedAt: string
  resolver: string
  transactionSignature?: string
  note: string
}

/**
 * Off-chain market metadata used by the demo application.
 *
 * Pool balances, positions, status, outcome, and claims remain authoritative on
 * the Solana program once a configured program is available. Values in this
 * interface are explicitly seeded sample data for the Devnet prototype.
 */
export interface ClimateMarket {
  id: string
  onchainMarketId: number
  question: string
  slug: string
  description: string
  category: MarketCategory
  continent: MarketContinent
  country?: string
  region: string
  latitude: number
  longitude: number
  closeTime: string
  resolutionTime?: string
  status: MarketStatus
  outcome: MarketOutcome
  yesPrice: number
  noPrice: number
  yesLiquidity: number
  noLiquidity: number
  totalVolume: number
  participants: number
  resolutionSource: string
  resolutionSourceUrl: string
  resolutionRules: string
  resolver: string
  createdAt: string
  featured: boolean
  trendingScore: number
  history: MarketHistoryPoint[]
  evidence: MarketEvidence[]
  recentTrades: MarketTrade[]
  resolution?: MarketResolution
  network: "devnet"
  settlementAsset: "SOL"
  marketModel: "pooled-binary"
  isDemo: boolean
  dataLabel: string
  dataDisclaimer: string
  /** Client-only status for the matching Devnet market PDA. */
  chainState?: MarketChainState
  /** Exact client-only pool values read from the Devnet market account. */
  chainYesLamports?: string
  chainNoLamports?: string
  chainTotalLamports?: string
}

export type PositionStatus =
  "open" | "claimable" | "claimed" | "refundable" | "refunded" | "lost"

export interface UserPosition {
  id: string
  wallet: string
  marketId: string
  onchainMarketId: number
  marketQuestion: string
  side: TradeSide
  amountLamports: string
  amountSol: number
  estimatedPayoutLamports: string
  estimatedPayoutSol: number
  claimableLamports: string
  claimableSol: number
  claimedLamports: string
  claimedSol: number
  status: PositionStatus
  marketStatus: MarketStatus
  marketOutcome: MarketOutcome
  openedAt: string
  updatedAt: string
  transactionSignature?: string
  network: "devnet"
  isDemo: boolean
}

export const ACTIVITY_TYPES = [
  "purchase_yes",
  "purchase_no",
  "claim",
  "refund",
  "market_created",
  "market_funded",
  "market_resolved",
] as const

export type ActivityType = (typeof ACTIVITY_TYPES)[number]

export type ActivityStatus = "pending" | "confirmed" | "failed"

export interface UserActivity {
  id: string
  wallet: string
  marketId: string
  onchainMarketId: number
  type: ActivityType
  status: ActivityStatus
  side?: TradeSide
  amountLamports?: string
  amountSol?: number
  transactionSignature: string
  explorerUrl: string
  timestamp: string
  failureReason?: string
  network: "devnet"
  isDemo: boolean
}

export interface IndexedTransactionInput {
  wallet: string
  marketId: string
  onchainMarketId: number
  type: ActivityType
  status: ActivityStatus
  side?: TradeSide
  amountLamports?: string
  transactionSignature: string
  timestamp?: string
  failureReason?: string
}

export interface MarketListQuery {
  search?: string
  category?: MarketCategory
  continent?: MarketContinent
  status?: MarketStatus
  featured?: boolean
  limit?: number
  offset?: number
}

export interface MarketListResult {
  markets: ClimateMarket[]
  total: number
  limit: number
  offset: number
}

export interface MarketHistoryResult {
  marketId: string
  question: string
  history: MarketHistoryPoint[]
  isDemo: boolean
  dataLabel: string
}
