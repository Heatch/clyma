import { getTransactionsCollection } from "@/lib/db/collections"
import type { TransactionDoc } from "@/lib/db/types"
import type { UserActivity, IndexedTransactionInput } from "@/lib/markets/types"
import { getUserByWallet } from "./users"
import { getMarketDocIdByMarketId } from "./markets"
import type { ObjectId } from "mongodb"

function transactionDocToActivity(doc: TransactionDoc): UserActivity {
  return {
    id: doc._id.toHexString(),
    wallet: doc.walletAddress,
    marketId: doc.marketDocId ?? "",
    onchainMarketId: doc.onchainMarketId ?? 0,
    type: doc.type,
    status: doc.status as UserActivity["status"],
    side: doc.type === "purchase_yes" ? "yes" : doc.type === "purchase_no" ? "no" : undefined,
    amountLamports: doc.amountLamports,
    amountSol: doc.amountSol,
    transactionSignature: doc.txSignature,
    explorerUrl: `https://explorer.solana.com/tx/${doc.txSignature}?cluster=devnet`,
    timestamp: doc.createdAt.toISOString(),
    failureReason: doc.failureReason,
    network: "devnet",
    isDemo: true,
  }
}

export async function insertTransaction(params: {
  walletAddress: string
  type: TransactionDoc["type"]
  amountSol?: number
  amountLamports?: string
  txSignature: string
  status: TransactionDoc["status"]
  marketDocId?: string
  onchainMarketId?: number
  failureReason?: string
}): Promise<TransactionDoc> {
  const transactions = await getTransactionsCollection()
  const user = await getUserByWallet(params.walletAddress)
  const marketObjId = params.marketDocId ? await getMarketDocIdByMarketId(params.marketDocId) : undefined

  const now = new Date()
  const doc = {
    userId: user?._id,
    walletAddress: params.walletAddress,
    type: params.type,
    chain: "solana" as const,
    token: "SOL" as const,
    amountSol: params.amountSol,
    amountLamports: params.amountLamports,
    txSignature: params.txSignature,
    status: params.status,
    relatedMarketId: marketObjId,
    marketDocId: params.marketDocId,
    onchainMarketId: params.onchainMarketId,
    createdAt: now,
    confirmedAt: params.status === "confirmed" ? now : undefined,
    failureReason: params.failureReason,
  }

  try {
    await transactions.insertOne(doc)
  } catch {
    // Duplicate signature - already indexed
  }

  return doc as TransactionDoc
}

export async function getActivityByWallet(walletAddress: string): Promise<UserActivity[]> {
  const transactions = await getTransactionsCollection()
  const docs = await transactions
    .find({ walletAddress })
    .sort({ createdAt: -1 })
    .limit(50)
    .toArray()
  return (docs as unknown as TransactionDoc[]).map(transactionDocToActivity)
}
