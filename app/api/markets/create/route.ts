import { apiError, apiSuccess } from "@/app/api/_shared/responses"
import { fetchOpeningProbability } from "@/lib/markets/openingPrice"
import { z } from "zod"

const createMarketSchema = z.object({
  question: z.string().min(10),
  region: z.string(),
  category: z.string(),
  news_context: z.string(),
  baseLiquidity: z.number().positive().default(100), // Base liquidity in SOL (or tokens)
})

export async function POST(request: Request) {
  // Disabled for launch: no UI calls this route, and every call triggers a
  // paid model inference. Re-enable explicitly with ENABLE_MARKET_CREATE=true
  // (e.g. for an admin-gated creation flow).
  if (process.env.ENABLE_MARKET_CREATE !== "true") {
    return apiError(
      "SERVICE_DISABLED",
      "Market creation is disabled on this server.",
      503,
    )
  }

  try {
    const body = await request.json()
    const parsed = createMarketSchema.safeParse(body)

    if (!parsed.success) {
      return apiError(
        "VALIDATION_ERROR",
        "Invalid request payload.",
        400,
        parsed.error.errors,
      )
    }

    const { question, region, category, news_context, baseLiquidity } =
      parsed.data

    // 1. Fetch probability from the ML inference server
    const p = await fetchOpeningProbability({
      question,
      region,
      category,
      news_context,
    })

    // 2. Calculate initial liquidity ratios based on probability p
    // For a standard LMSR/AMM, if p = x / (x + y),
    // we can scale the base liquidity L such that x = L * p and y = L * (1 - p)
    const yesAmount = baseLiquidity * p
    const noAmount = baseLiquidity * (1 - p)

    // 3. Return the calculated amounts so the frontend can build the `fund_market` instruction
    return apiSuccess({
      probability: p,
      yesAmount,
      noAmount,
      message:
        "Probability calculated successfully. Use these amounts for the fund_market instruction.",
    })
  } catch (error) {
    console.error("Error creating market:", error)
    return apiError(
      "INTERNAL_ERROR",
      "Failed to calculate opening probability",
      500,
    )
  }
}
