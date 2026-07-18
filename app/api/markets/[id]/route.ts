import { apiError, apiSuccess } from "@/app/api/_shared/responses"
import { initDb } from "@/lib/db/init"
import { getMarketById } from "@/lib/db/repositories/markets"

interface MarketByIdContext {
  params: Promise<{ id: string }>
}

export async function GET(_request: Request, context: MarketByIdContext) {
  await initDb()

  const { id } = await context.params
  const market = await getMarketById(id)

  if (!market) {
    return apiError("MARKET_NOT_FOUND", "Market not found", 404)
  }

  return apiSuccess(market)
}
