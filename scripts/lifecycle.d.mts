// Types for ../lifecycle.mjs (plain-JS seeder/ops script). Kept in sync
// manually; only the pure, tested surface is declared here.

import type { PublicKey } from "@solana/web3.js"

export const RESOLUTION_DECISIONS: { yes: 0; no: 1; cancelled: 2 }

export function instructionDiscriminator(name: string): Buffer

export function buildCloseMarket(
  protocol: PublicKey,
  market: PublicKey,
  closer: PublicKey,
): {
  programId: PublicKey
  keys: Array<{ pubkey: PublicKey; isSigner: boolean; isWritable: boolean }>
  data: Buffer
}

export function buildResolveMarket(
  protocol: PublicKey,
  market: PublicKey,
  resolver: PublicKey,
  decision: number,
): {
  programId: PublicKey
  keys: Array<{ pubkey: PublicKey; isSigner: boolean; isWritable: boolean }>
  data: Buffer
}

export function resolveDraw(marketId: string, modelOdds: number): "yes" | "no"

export function readEstimate(raw: unknown): number | null

export function validateRaw(raw: unknown): { targetYes: number } | null

export function modelOddsOf(doc: {
  marketId?: string
  yesPrice?: number
  history?: Array<{ yesProbability?: number }>
}): number

export interface BoostPlanMarket {
  marketDocId: string
  onchainMarketId: number
  curYesSol: number
  curNoSol: number
  dbTotalSol: number
}

export interface BoostPlanEntry extends BoostPlanMarket {
  curYes: number
  curNo: number
  curTotal: number
  targetYes: number
  targetNo: number
  targetTotal: number
  addYes: number
  addNo: number
  addTotal: number
}

export function planBoostDepths(
  markets: BoostPlanMarket[],
  opts: {
    targetTotalSol: number
    minDepthSol: number
    maxDepthSol: number
    seedTag: string
  },
): BoostPlanEntry[]

export function decodeMarketPools(
  info:
    | {
        data: Buffer
      }
    | null
    | undefined,
): {
  yes: number
  no: number
  total: number
  status: number
} | null

export function __useProgramIdForTests(publicKey: PublicKey): void
