import { apiError, apiSuccess } from "@/app/api/_shared/responses"
import { initDb } from "@/lib/db/init"
import { getMarketsByContinent } from "@/lib/db/repositories/markets"
import { marketListQuerySchema, formatZodIssues } from "@/lib/validation/marketSchemas"

interface RegionContext {
  params: Promise<{ continent: string }>
}

export async function GET(request: Request, context: RegionContext) {
  await initDb()

  const { continent } = await context.params
  const { searchParams } = new URL(request.url)
  const rawParams: Record<string, string> = {}
  searchParams.forEach((v, k) => { rawParams[k] = v })

  const parsed = marketListQuerySchema.safeParse(rawParams)
  if (!parsed.success) {
    return apiError("VALIDATION_ERROR", "Invalid query parameters", 400, formatZodIssues(parsed.error))
  }

  const result = await getMarketsByContinent(continent, parsed.data ?? {})
  return apiSuccess(result)
}
