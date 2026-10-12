import { initDb } from "@/lib/db/init"
import {
  findTransactionBySignature,
  insertTransaction,
} from "@/lib/db/repositories/transactions"
import { insertPosition } from "@/lib/db/repositories/positions"
import { insertPriceSnapshot } from "@/lib/db/repositories/marketPrices"
import {
  appendMarketHistoryPoint,
  getMarketById,
  incrementMarketActivity,
} from "@/lib/db/repositories/markets"
import {
  indexTransactionSchema,
  formatZodIssues,
} from "@/lib/validation/marketSchemas"
import { apiError, apiSuccess } from "@/app/api/_shared/responses"

function lamportsToSol(lamports: string): number {
  try {
    return Number(BigInt(lamports)) / 1_000_000_000
  } catch {
    return 0
  }
}

const LAMPORTS_PER_SOL = 1_000_000_000n

function toLamports(amountSol: number): bigint {
  if (!Number.isFinite(amountSol) || amountSol <= 0) return 0n
  return BigInt(Math.round(amountSol * 1_000_000_000))
}

/**
 * Pro-rata payout estimate for a purchase, mirroring the on-chain
 * settlement formula (user position x total pool / winning-side pool)
 * evaluated at post-trade pool sizes.
 */
function estimatePayoutLamports(
  side: "yes" | "no",
  amountLamports: bigint,
  yesLiquiditySol: number,
  noLiquiditySol: number,
): bigint {
  const yesLiq = toLamports(yesLiquiditySol)
  const noLiq = toLamports(noLiquiditySol)
  const sideLiqAfter = (side === "yes" ? yesLiq : noLiq) + amountLamports
  if (sideLiqAfter <= 0n) return 0n
  const totalAfter = yesLiq + noLiq + amountLamports
  return (amountLamports * totalAfter) / sideLiqAfter
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
    return apiError(
      "VALIDATION_ERROR",
      "Invalid transaction data",
      400,
      formatZodIssues(parsed.error),
    )
  }

  const input = parsed.data

  // Idempotency: retries and duplicate client POSTs share one signature.
  const existing = await findTransactionBySignature(input.transactionSignature)
  if (existing) {
    return apiSuccess({
      id: existing._id,
      signature: input.transactionSignature,
      deduped: true,
    })
  }

  const amountSol = input.amountLamports
    ? lamportsToSol(input.amountLamports)
    : undefined

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
    const market = await getMarketById(input.marketId)

    // Server-computed payout estimate (pro-rata at post-trade pools) so
    // positions never index with a zero payout.
    let estimatedPayoutSol = 0
    let estimatedPayoutLamports = "0"
    try {
      if (input.amountLamports) {
        const payout = estimatePayoutLamports(
          side,
          BigInt(input.amountLamports),
          market?.yesLiquidity ?? 0,
          market?.noLiquidity ?? 0,
        )
        estimatedPayoutLamports = payout.toString()
        estimatedPayoutSol = Number(payout) / Number(LAMPORTS_PER_SOL)
      }
    } catch {
      estimatedPayoutSol = 0
      estimatedPayoutLamports = "0"
    }

    await insertPosition({
      walletAddress: input.wallet,
      marketDocId: input.marketId,
      onchainMarketId: input.onchainMarketId,
      marketQuestion: market?.question ?? "",
      side,
      amountSol: amountSol ?? 0,
      amountLamports: input.amountLamports ?? "0",
      estimatedPayoutSol,
      estimatedPayoutLamports,
      txSignature: input.transactionSignature,
    })

    // Live counters + chart point. Prices come from the client's pre-trade
    // quote (post-trade pool ratios); skip the snapshot if absent rather
    // than recording zeros.
    if (
      typeof input.yesPrice === "number" &&
      typeof input.noPrice === "number"
    ) {
      const yesLiquidity =
        (market?.yesLiquidity ?? 0) + (side === "yes" ? (amountSol ?? 0) : 0)
      const noLiquidity =
        (market?.noLiquidity ?? 0) + (side === "no" ? (amountSol ?? 0) : 0)
      const totalVolume = (market?.totalVolume ?? 0) + (amountSol ?? 0)

      await insertPriceSnapshot({
        marketDocId: input.marketId,
        yesPrice: input.yesPrice,
        noPrice: input.noPrice,
        volume: amountSol ?? 0,
        triggerEvent: "trade",
        yesLiquidity,
        noLiquidity,
        totalVolume,
      })

      await appendMarketHistoryPoint(input.marketId, {
        timestamp: new Date().toISOString(),
        yesProbability: input.yesPrice,
        noProbability: input.noPrice,
        totalVolume,
        yesLiquidity,
        noLiquidity,
      })
    }

    if (amountSol !== undefined) {
      await incrementMarketActivity({
        marketDocId: input.marketId,
        amountSol,
        walletAddress: input.wallet,
      })
    }
  }

  return apiSuccess({
    id: tx._id,
    signature: input.transactionSignature,
  })
}
