import {
  existingMarketIds,
  insertPosition as storeInsertPosition,
  listPositionsByWallet as storeListByWallet,
  marketPoolsByDocIds,
  updatePositionStatusById,
} from "@/lib/db/store.mjs"
import type { PositionDoc } from "@/lib/db/types"
import type { UserPosition } from "@/lib/markets/types"

const LAMPORTS_PER_SOL = 1_000_000_000

function toLamports(amountSol: number): bigint {
  if (!Number.isFinite(amountSol) || amountSol <= 0) return 0n
  return BigInt(Math.round(amountSol * LAMPORTS_PER_SOL))
}

/**
 * Live payout estimate from current pools (pro-rata at post-trade sizes).
 * Falls back to the stored value when pools are unknown or degenerate.
 */
function livePayoutEstimate(
  doc: PositionDoc,
  pools: { yesLiquidity: number; noLiquidity: number } | undefined,
): { estimatedPayoutSol: number; estimatedPayoutLamports: string } {
  const stored = {
    estimatedPayoutSol: doc.estimatedPayoutSol,
    estimatedPayoutLamports: doc.estimatedPayoutLamports,
  }
  if (!pools) return stored
  let amountLamports: bigint
  try {
    amountLamports = BigInt(doc.amountLamports)
  } catch {
    return stored
  }
  if (amountLamports <= 0n) return stored
  const sideLiq =
    doc.side === "yes"
      ? toLamports(pools.yesLiquidity)
      : toLamports(pools.noLiquidity)
  const sideLiqAfter = sideLiq + amountLamports
  if (sideLiqAfter <= 0n) return stored
  const totalAfter =
    toLamports(pools.yesLiquidity) +
    toLamports(pools.noLiquidity) +
    amountLamports
  const payout = (amountLamports * totalAfter) / sideLiqAfter
  return {
    estimatedPayoutSol: Number(payout) / LAMPORTS_PER_SOL,
    estimatedPayoutLamports: payout.toString(),
  }
}

function positionDocToUserPosition(
  doc: PositionDoc,
  pools?: { yesLiquidity: number; noLiquidity: number },
): UserPosition {
  // Unsettled positions track live pools; settled rows keep stored values.
  const live =
    doc.status === "open"
      ? livePayoutEstimate(doc, pools)
      : {
          estimatedPayoutSol: doc.estimatedPayoutSol,
          estimatedPayoutLamports: doc.estimatedPayoutLamports,
        }
  return {
    id: doc._id,
    wallet: doc.walletAddress,
    marketId: doc.marketDocId,
    onchainMarketId: doc.onchainMarketId,
    marketQuestion: doc.marketQuestion,
    side: doc.side,
    amountLamports: doc.amountLamports,
    amountSol: doc.amountSol,
    estimatedPayoutLamports: live.estimatedPayoutLamports,
    estimatedPayoutSol: live.estimatedPayoutSol,
    claimableLamports: "0",
    claimableSol: 0,
    claimedLamports: "0",
    claimedSol: 0,
    status: mapPositionStatus(doc.status),
    marketStatus: "open",
    marketOutcome: "unresolved",
    openedAt: doc.createdAt.toISOString(),
    updatedAt: (doc.settledAt ?? doc.createdAt).toISOString(),
    transactionSignature: doc.txSignature,
    network: "devnet",
  }
}

function mapPositionStatus(
  status: PositionDoc["status"],
): UserPosition["status"] {
  switch (status) {
    case "open":
      return "open"
    case "won":
      return "claimable"
    case "lost":
      return "lost"
    case "claimed":
      return "claimed"
    case "refunded":
      return "refunded"
  }
}

export async function insertPosition(params: {
  walletAddress: string
  marketDocId: string
  onchainMarketId: number
  marketQuestion: string
  side: "yes" | "no"
  amountSol: number
  amountLamports: string
  estimatedPayoutSol: number
  estimatedPayoutLamports: string
  txSignature?: string
}): Promise<PositionDoc> {
  return storeInsertPosition(params) as unknown as PositionDoc
}

export async function getPositionsByWallet(
  walletAddress: string,
): Promise<PositionDoc[]> {
  return storeListByWallet(walletAddress) as unknown as PositionDoc[]
}

export async function getPositionsByWalletForApi(
  walletAddress: string,
): Promise<UserPosition[]> {
  const docs = await getPositionsByWallet(walletAddress)
  // Drop rows pointing at markets that no longer exist (e.g. recorded
  // before a reseed replaced the catalog).
  const alive = new Set(existingMarketIds(docs.map((doc) => doc.marketDocId)))
  const live = docs.filter((doc) => alive.has(doc.marketDocId))
  const pools = marketPoolsByDocIds(live.map((doc) => doc.marketDocId))
  return live.map((doc) =>
    positionDocToUserPosition(doc, pools.get(doc.marketDocId)),
  )
}

export async function updatePositionStatus(
  positionId: string,
  status: PositionDoc["status"],
  txSignature?: string,
): Promise<void> {
  updatePositionStatusById(positionId, status, txSignature)
}
