import {
  existingMarketIds,
  insertPosition as storeInsertPosition,
  listPositionsByWallet as storeListByWallet,
  updatePositionStatusById,
} from "@/lib/db/store.mjs"
import type { PositionDoc } from "@/lib/db/types"
import type { UserPosition } from "@/lib/markets/types"

function positionDocToUserPosition(doc: PositionDoc): UserPosition {
  return {
    id: doc._id,
    wallet: doc.walletAddress,
    marketId: doc.marketDocId,
    onchainMarketId: doc.onchainMarketId,
    marketQuestion: doc.marketQuestion,
    side: doc.side,
    amountLamports: doc.amountLamports,
    amountSol: doc.amountSol,
    estimatedPayoutLamports: doc.estimatedPayoutLamports,
    estimatedPayoutSol: doc.estimatedPayoutSol,
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
  return docs
    .filter((doc) => alive.has(doc.marketDocId))
    .map(positionDocToUserPosition)
}

export async function updatePositionStatus(
  positionId: string,
  status: PositionDoc["status"],
  txSignature?: string,
): Promise<void> {
  updatePositionStatusById(positionId, status, txSignature)
}
