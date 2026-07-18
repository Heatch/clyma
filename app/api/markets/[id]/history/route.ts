import { apiError, apiSuccess } from "@/app/api/_shared/responses"
import { initDb } from "@/lib/db/init"
import { getMarketHistory } from "@/lib/db/repositories/markets"

interface MarketHistoryContext {
  params: Promise<{ id: string }>
}

export async function GET(_request: Request, context: MarketHistoryContext) {
  await initDb()

  const { id } = await context.params
  const result = await getMarketHistory(id)

  if (!result) {
    return apiError("MARKET_NOT_FOUND", "Market not found", 404)
  }

  return apiSuccess(result)
}
