import { initDb } from "@/lib/db/init"
import { insertTransaction } from "@/lib/db/repositories/transactions"
import { insertPosition } from "@/lib/db/repositories/positions"
import { insertPriceSnapshot } from "@/lib/db/repositories/marketPrices"
import { indexTransactionSchema, formatZodIssues } from "@/lib/validation/marketSchemas"
import { apiError, apiSuccess } from "@/app/api/_shared/responses"

function lamportsToSol(lamports: string): number {
  try {
    return Number(BigInt(lamports)) / 1_000_000_000
  } catch {
    return 0
  }
}

export async function POST(request: Request) {
  await initDb()

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return apiError("INVALID_JSON", "Request body must be valid JSON", 400)
  }

  const parsed = indexTransactionSchema.safeParse(body)
  if (!parsed.success) {
    return apiError("VALIDATION_ERROR", "Invalid transaction data", 400, formatZodIssues(parsed.error))
  }

  const input = parsed.data
  const amountSol = input.amountLamports ? lamportsToSol(input.amountLamports) : undefined

  const tx = await insertTransaction({
    walletAddress: input.wallet,
    type: input.type,
    amountSol,
    amountLamports: input.amountLamports,
    txSignature: input.transactionSignature,
    status: input.status,
    marketDocId: input.marketId,
    onchainMarketId: input.onchainMarketId,
    failureReason: input.failureReason,
  })

  if (input.type === "purchase_yes" || input.type === "purchase_no") {
    const side = input.type === "purchase_yes" ? "yes" : "no"

    await insertPosition({
      walletAddress: input.wallet,
      marketDocId: input.marketId,
      onchainMarketId: input.onchainMarketId,
      marketQuestion: "",
      side,
      amountSol: amountSol ?? 0,
      amountLamports: input.amountLamports ?? "0",
      estimatedPayoutSol: 0,
      estimatedPayoutLamports: "0",
      txSignature: input.transactionSignature,
    })

    await insertPriceSnapshot({
      marketDocId: input.marketId,
      yesPrice: 0,
      noPrice: 0,
      volume: amountSol ?? 0,
      triggerEvent: "trade",
    })
  }

  return apiSuccess({ id: tx._id.toHexString(), signature: input.transactionSignature })
}
