import {
  findTransactionBySignature as storeFindBySignature,
  insertTransaction as storeInsertTransaction,
  listActivityByWallet as storeListActivity,
} from "@/lib/db/store.mjs"
import type { TransactionDoc } from "@/lib/db/types"
import type { UserActivity } from "@/lib/markets/types"

function transactionDocToActivity(doc: TransactionDoc): UserActivity {
  return {
    id: doc._id,
    wallet: doc.walletAddress,
    marketId: doc.marketDocId ?? "",
    onchainMarketId: doc.onchainMarketId ?? 0,
    type: doc.type,
    status: doc.status as UserActivity["status"],
    side:
      doc.type === "purchase_yes"
        ? "yes"
        : doc.type === "purchase_no"
          ? "no"
          : undefined,
    amountLamports: doc.amountLamports,
    amountSol: doc.amountSol,
    transactionSignature: doc.txSignature,
    explorerUrl: `https://explorer.solana.com/tx/${doc.txSignature}?cluster=devnet`,
    timestamp: doc.createdAt.toISOString(),
    failureReason: doc.failureReason,
    network: "devnet",
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
  return storeInsertTransaction(params).doc as unknown as TransactionDoc
}

export async function findTransactionBySignature(
  txSignature: string,
): Promise<TransactionDoc | null> {
  const doc = storeFindBySignature(txSignature)
  return (doc as unknown as TransactionDoc | null) ?? null
}

export async function getActivityByWallet(
  walletAddress: string,
): Promise<UserActivity[]> {
  const docs = storeListActivity(walletAddress) as unknown as TransactionDoc[]
  return docs.map(transactionDocToActivity)
}
