import { SignJWT, jwtVerify } from "jose"
import { NextResponse } from "next/server"

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || "dev-secret-change-in-production",
)
const JWT_ISSUER = "climate-prediction-market"
const JWT_AUDIENCE = "climate-prediction-market-app"
const JWT_EXPIRATION = "7d"

export interface AuthPayload {
  sub: string
  wallet: string
}

export async function signJwt(payload: AuthPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setIssuer(JWT_ISSUER)
    .setAudience(JWT_AUDIENCE)
    .setExpirationTime(JWT_EXPIRATION)
    .sign(JWT_SECRET)
}

export async function verifyJwt(token: string): Promise<AuthPayload | null> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET, {
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    })
    return payload as unknown as AuthPayload
  } catch {
    return null
  }
}

export function extractBearerToken(request: Request): string | null {
  const auth = request.headers.get("authorization")
  if (!auth) return null
  const parts = auth.split(" ")
  if (parts.length !== 2 || parts[0] !== "Bearer") return null
  return parts[1] ?? null
}

export function unauthorizedResponse() {
  return NextResponse.json(
    { error: { code: "UNAUTHORIZED", message: "Authentication required" } },
    { status: 401 },
  )
}
