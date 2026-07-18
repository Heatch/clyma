import { getPositionsCollection } from "@/lib/db/collections"
import type { PositionDoc } from "@/lib/db/types"
import type { UserPosition } from "@/lib/markets/types"
import type { ObjectId } from "mongodb"
import { getUserByWallet } from "./users"
import { getMarketDocIdByMarketId } from "./markets"

function positionDocToUserPosition(doc: PositionDoc): UserPosition {
  return {
    id: doc._id.toHexString(),
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
    isDemo: true,
  }
}

function mapPositionStatus(status: PositionDoc["status"]): UserPosition["status"] {
  switch (status) {
    case "open": return "open"
    case "won": return "claimable"
    case "lost": return "lost"
    case "claimed": return "claimed"
    case "refunded": return "refunded"
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
  const positions = await getPositionsCollection()
  const user = await getUserByWallet(params.walletAddress)
  const userId = user?._id
  const marketId = await getMarketDocIdByMarketId(params.marketDocId)

  const doc: Omit<PositionDoc, "_id"> = {
    userId,
    walletAddress: params.walletAddress,
    marketId: marketId ?? undefined,
    marketDocId: params.marketDocId,
    onchainMarketId: params.onchainMarketId,
    marketQuestion: params.marketQuestion,
    side: params.side,
    amountSol: params.amountSol,
    amountLamports: params.amountLamports,
    estimatedPayoutSol: params.estimatedPayoutSol,
    estimatedPayoutLamports: params.estimatedPayoutLamports,
    status: "open" as const,
    txSignature: params.txSignature,
    createdAt: new Date(),
  }

  const result = await positions.insertOne(doc)
  return { ...doc, _id: result.insertedId }
}

export async function getPositionsByWallet(walletAddress: string): Promise<PositionDoc[]> {
  const positions = await getPositionsCollection()
  return (await positions
    .find({ walletAddress })
    .sort({ createdAt: -1 })
    .toArray()) as unknown as PositionDoc[]
}

export async function getPositionsByWalletForApi(walletAddress: string): Promise<UserPosition[]> {
  const docs = await getPositionsByWallet(walletAddress)
  return docs.map(positionDocToUserPosition)
}

export async function updatePositionStatus(
  positionId: string,
  status: PositionDoc["status"],
  txSignature?: string,
): Promise<void> {
  const positions = await getPositionsCollection()
  const { ObjectId } = await import("mongodb")
  const update: Record<string, unknown> = {
    $set: { status, settledAt: new Date() } as Record<string, unknown>,
  }
  if (txSignature) (update.$set as Record<string, unknown>).txSignature = txSignature
  await positions.updateOne({ _id: new ObjectId(positionId) }, update)
}
