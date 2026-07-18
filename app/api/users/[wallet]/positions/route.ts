import { apiError, apiSuccess } from "@/app/api/_shared/responses"
import { initDb } from "@/lib/db/init"
import { getPositionsByWalletForApi } from "@/lib/db/repositories/positions"
import { walletParamSchema, formatZodIssues } from "@/lib/validation/marketSchemas"

interface UserPositionsRouteContext {
  params: Promise<{ wallet: string }>
}

export async function GET(_request: Request, context: UserPositionsRouteContext) {
  await initDb()

  const params = walletParamSchema.safeParse(await context.params)
  if (!params.success) {
    return apiError("VALIDATION_ERROR", "The wallet address is invalid.", 400, formatZodIssues(params.error))
  }

  const positions = await getPositionsByWalletForApi(params.data.wallet)
  return apiSuccess({
    wallet: params.data.wallet,
    positions,
    total: positions.length,
  })
}
