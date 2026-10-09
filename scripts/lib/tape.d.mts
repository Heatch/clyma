// Types for ./tape.mjs (plain-JS tape generator). Kept in sync manually;
// the interface is small and stable by design.

export const LAMPORTS_PER_SOL: number

export function tapeWalletAddress(marketId: string, index: number): string

export interface TapeTrade {
  side: "yes" | "no"
  amountLamports: number
  amountSol: number
  probability: number
  timestamp: string
  walletIndex: number
  wallet: string
}

export interface TapeHistoryPoint {
  timestamp: string
  yesProbability: number
  noProbability: number
  totalVolume: number
  yesLiquidity: number
  noLiquidity: number
}

export interface TapeRecentTrade {
  id: string
  marketId: string
  side: "yes" | "no"
  amountSol: number
  amountLamports: string
  probability: number
  estimatedPayoutSol: number
  wallet: string
  timestamp: string
}

export interface TapeInput {
  marketId: string
  targetYes: number
  depthSol: number
  endTime?: number
  seedTag?: string
}

export interface Tape {
  marketId: string
  targetYes: number
  depthSol: number
  startTime: string
  endTime: string
  tradeCount: number
  walletCount: number
  shockWindows: number
  genesis: { yesLamports: number; noLamports: number }
  trades: TapeTrade[]
  pools: { yesLamports: number; noLamports: number; totalLamports: number }
  history: TapeHistoryPoint[]
  totalVolumeLamports: number
  totalVolumeSol: number
  participants: number
  recentTrades: TapeRecentTrade[]
}

export function buildTape(input: TapeInput): Tape
