import { NextResponse } from "next/server"
import { insertChallenge } from "@/lib/db/store.mjs"

const CHALLENGE_TTL_MS = 5 * 60 * 1000

/** Hex nonce from Web Crypto — available on Workers and Node alike. */
function randomHex(bytes: number): string {
  const buffer = new Uint8Array(bytes)
  crypto.getRandomValues(buffer)
  return Array.from(buffer, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  )
}

export async function POST(request: Request) {
  let body: { walletAddress?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      {
        error: {
          code: "INVALID_JSON",
          message: "Request body must be valid JSON",
        },
      },
      { status: 400 },
    )
  }

  const walletAddress = body.walletAddress?.trim()
  if (
    !walletAddress ||
    walletAddress.length < 32 ||
    walletAddress.length > 44
  ) {
    return NextResponse.json(
      {
        error: {
          code: "INVALID_WALLET",
          message: "A valid Solana wallet address is required",
        },
      },
      { status: 400 },
    )
  }

  const nonce = randomHex(32)
  const challenge = (await insertChallenge(
    walletAddress,
    nonce,
    CHALLENGE_TTL_MS,
  )) as { expiresAt: Date }

  const message = `Sign this message to authenticate with Climate Prediction Market.\n\nWallet: ${walletAddress}\nNonce: ${nonce}`

  return NextResponse.json({
    data: {
      nonce,
      message,
      expiresAt: challenge.expiresAt.toISOString(),
    },
  })
}
