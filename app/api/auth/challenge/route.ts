import { NextResponse } from "next/server"
import { randomBytes } from "node:crypto"
import { getAuthChallengesCollection } from "@/lib/db/collections"

const CHALLENGE_TTL_MS = 5 * 60 * 1000

export async function POST(request: Request) {
  let body: { walletAddress?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { error: { code: "INVALID_JSON", message: "Request body must be valid JSON" } },
      { status: 400 },
    )
  }

  const walletAddress = body.walletAddress?.trim()
  if (!walletAddress || walletAddress.length < 32 || walletAddress.length > 44) {
    return NextResponse.json(
      { error: { code: "INVALID_WALLET", message: "A valid Solana wallet address is required" } },
      { status: 400 },
    )
  }

  const nonce = randomBytes(32).toString("hex")
  const now = new Date()
  const expiresAt = new Date(now.getTime() + CHALLENGE_TTL_MS)

  const challenges = await getAuthChallengesCollection()
  await challenges.insertOne({
    walletAddress,
    nonce,
    createdAt: now,
    expiresAt,
    used: false,
  })

  const message = `Sign this message to authenticate with Climate Prediction Market.\n\nWallet: ${walletAddress}\nNonce: ${nonce}`

  return NextResponse.json({
    data: {
      nonce,
      message,
      expiresAt: expiresAt.toISOString(),
    },
  })
}
