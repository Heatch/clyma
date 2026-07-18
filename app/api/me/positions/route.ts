import { NextResponse } from "next/server"
import { extractBearerToken, verifyJwt, unauthorizedResponse } from "@/lib/auth"
import { initDb } from "@/lib/db/init"
import { getPositionsByWalletForApi } from "@/lib/db/repositories/positions"
import { apiSuccess } from "@/app/api/_shared/responses"

export async function GET(request: Request) {
  await initDb()

  const token = extractBearerToken(request)
  if (!token) return unauthorizedResponse()

  const payload = await verifyJwt(token)
  if (!payload) return unauthorizedResponse()

  const positions = await getPositionsByWalletForApi(payload.wallet)
  return apiSuccess({
    wallet: payload.wallet,
    positions,
    total: positions.length,
  })
}
