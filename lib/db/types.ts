import type { ObjectId } from "mongodb"

export interface UserDoc {
  _id: ObjectId
  walletAddress: string
  externalUserId?: string
  username?: string
  createdAt: Date
  lastLoginAt: Date
}

export interface MarketDoc {
  _id: ObjectId
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
  isDemo: boolean
  dataLabel: string
  dataDisclaimer: string
  openAt: Date
  closesAt: Date
  resolvesAt: Date
  createdAt: Date
}

export interface PositionDoc {
  _id: ObjectId
  userId?: ObjectId
  walletAddress: string
  marketId?: ObjectId
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
  _id: ObjectId
  userId?: ObjectId
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
  relatedPositionId?: ObjectId
  relatedMarketId?: ObjectId
  marketDocId?: string
  onchainMarketId?: number
  createdAt: Date
  confirmedAt?: Date
  failureReason?: string
}

export interface ResolutionDoc {
  _id: ObjectId
  marketId: ObjectId
  marketDocId: string
  dataSource: string
  resolvedOutcome: "yes" | "no" | "cancelled"
  resolverType: "automated" | "manual-override"
  resolverWallet: string
  proofUrl?: string
  resolvedAt: Date
}

export interface MarketPriceDoc {
  _id: ObjectId
  marketId: ObjectId
  timestamp: Date
  yesPrice: number
  noPrice: number
  volume: number
  triggerEvent: "trade" | "resolution" | "creation"
}

export interface AuthChallengeDoc {
  _id: ObjectId
  walletAddress: string
  nonce: string
  createdAt: Date
  expiresAt: Date
  used: boolean
}
