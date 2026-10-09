// Types for ../lifecycle.mjs (plain-JS seeder/ops script). Kept in sync
// manually; only the pure, tested surface is declared here.

import type { PublicKey } from "@solana/web3.js"

export const RESOLUTION_DECISIONS: { yes: 0; no: 1; cancelled: 2 }

export function instructionDiscriminator(name: string): Buffer

export function buildCloseMarket(
  protocol: PublicKey,
  market: PublicKey,
  closer: PublicKey,
): { programId: PublicKey; keys: Array<{ pubkey: PublicKey; isSigner: boolean; isWritable: boolean }>; data: Buffer }

export function buildResolveMarket(
  protocol: PublicKey,
  market: PublicKey,
  resolver: PublicKey,
  decision: number,
): { programId: PublicKey; keys: Array<{ pubkey: PublicKey; isSigner: boolean; isWritable: boolean }>; data: Buffer }

export function resolveDraw(marketId: string, modelOdds: number): "yes" | "no"

export function modelOddsOf(doc: {
  marketId?: string
  yesPrice?: number
  history?: Array<{ yesProbability?: number }>
}): number

export function __useProgramIdForTests(publicKey: PublicKey): void
