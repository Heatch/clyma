import { extractBearerToken, verifyJwt, unauthorizedResponse } from "@/lib/auth"
import { initDb } from "@/lib/db/init"
import { getActivityByWallet } from "@/lib/db/repositories/transactions"
import { apiSuccess } from "@/app/api/_shared/responses"

export async function GET(request: Request) {
  await initDb()

  const token = extractBearerToken(request)
  if (!token) return unauthorizedResponse()

  const payload = await verifyJwt(token)
  if (!payload) return unauthorizedResponse()

  const activity = await getActivityByWallet(payload.wallet)
  return apiSuccess({
    wallet: payload.wallet,
    activity,
    total: activity.length,
  })
}
