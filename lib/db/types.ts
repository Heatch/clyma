import type {
  MarketEvidence,
  MarketHistoryPoint,
  MarketTrade,
} from "@/lib/markets/types"

export interface UserDoc {
  _id: string
  walletAddress: string
  externalUserId?: string
  username?: string
  createdAt: Date
  lastLoginAt: Date
}

export interface MarketDoc {
  _id: string
  marketId: string
  onchainMarketId: number
  title: string
  question: string
  description: string
  slug: string
  category: string
  continent: string
  country?: string
  region: string
  latitude: number
  longitude: number
  resolutionSource: string
  resolutionSourceUrl: string
  resolutionRules: string
  status: "open" | "closed" | "resolved" | "cancelled"
  outcome: "unresolved" | "yes" | "no" | "cancelled"
  yesPrice: number
  noPrice: number
  yesLiquidity: number
  noLiquidity: number
  totalVolume: number
  participants: number
  featured: boolean
  trendingScore: number
  resolver: string
  participantWallets?: string[]
  history?: MarketHistoryPoint[]
  evidence?: MarketEvidence[]
  recentTrades?: MarketTrade[]
  openAt: Date
  closesAt: Date
  resolvesAt: Date
  createdAt: Date
}

export interface PositionDoc {
  _id: string
  userId?: string
  walletAddress: string
  marketId?: string
  marketDocId: string
  onchainMarketId: number
  marketQuestion: string
  side: "yes" | "no"
  amountSol: number
  amountLamports: string
  estimatedPayoutSol: number
  estimatedPayoutLamports: string
  status: "open" | "won" | "lost" | "claimed" | "refunded"
  txSignature?: string
  createdAt: Date
  settledAt?: Date
}

export interface TransactionDoc {
  _id: string
  userId?: string
  walletAddress: string
  type:
    | "purchase_yes"
    | "purchase_no"
    | "claim"
    | "refund"
    | "market_created"
    | "market_funded"
    | "market_resolved"
  chain: "solana"
  token: "SOL"
  amountSol?: number
  amountLamports?: string
  txSignature: string
  status: "pending" | "confirmed" | "failed"
  relatedPositionId?: string
  relatedMarketId?: string
  marketDocId?: string
  onchainMarketId?: number
  createdAt: Date
  confirmedAt?: Date
  failureReason?: string
}

export interface ResolutionDoc {
  _id: string
  marketId: string
  marketDocId: string
  dataSource: string
  resolvedOutcome: "yes" | "no" | "cancelled"
  resolverType: "automated" | "manual-override"
  resolverWallet: string
  proofUrl?: string
  resolvedAt: Date
}

export interface MarketPriceDoc {
  _id: string
  marketId: string
  timestamp: Date
  yesPrice: number
  noPrice: number
  volume: number
  triggerEvent: "trade" | "resolution" | "creation"
  yesLiquidity?: number
  noLiquidity?: number
  totalVolume?: number
}

export interface AuthChallengeDoc {
  _id: string
  walletAddress: string
  nonce: string
  createdAt: Date
  expiresAt: Date
  used: boolean
}
