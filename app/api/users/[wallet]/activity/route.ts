import { apiError, apiSuccess } from "@/app/api/_shared/responses"
import { initDb } from "@/lib/db/init"
import { getActivityByWallet } from "@/lib/db/repositories/transactions"
import { walletParamSchema, formatZodIssues } from "@/lib/validation/marketSchemas"

interface UserActivityRouteContext {
  params: Promise<{ wallet: string }>
}

export async function GET(_request: Request, context: UserActivityRouteContext) {
  await initDb()

  const params = walletParamSchema.safeParse(await context.params)
  if (!params.success) {
    return apiError("VALIDATION_ERROR", "The wallet address is invalid.", 400, formatZodIssues(params.error))
  }

  const activity = await getActivityByWallet(params.data.wallet)
  return apiSuccess({
    wallet: params.data.wallet,
    activity,
    total: activity.length,
  })
}
