import { apiError, apiSuccess } from "@/app/api/_shared/responses"
import { initDb } from "@/lib/db/init"
import { queryMarkets } from "@/lib/db/repositories/markets"
import { marketListQuerySchema, formatZodIssues } from "@/lib/validation/marketSchemas"

export async function GET(request: Request) {
  await initDb()

  const { searchParams } = new URL(request.url)
  const rawParams: Record<string, string> = {}
  searchParams.forEach((v, k) => { rawParams[k] = v })

  const parsed = marketListQuerySchema.safeParse(rawParams)
  if (!parsed.success) {
    return apiError("VALIDATION_ERROR", "Invalid query parameters", 400, formatZodIssues(parsed.error))
  }

  const result = await queryMarkets(parsed.data)
  return apiSuccess(result)
}
