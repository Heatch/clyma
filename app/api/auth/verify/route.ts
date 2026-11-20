import { NextResponse } from "next/server"
import nacl from "tweetnacl"
import bs58 from "bs58"
import { getChallenge, markChallengeUsed } from "@/lib/db/store.mjs"
import { upsertUser } from "@/lib/db/repositories/users"
import { signJwt } from "@/lib/auth"

/** Hex string -> bytes without Node's Buffer (Workers-safe). */
function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i += 1) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  }
  return out
}

export async function POST(request: Request) {
  let body: { walletAddress?: string; signature?: string; nonce?: string }
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

  const { walletAddress, signature, nonce } = body
  if (!walletAddress || !signature || !nonce) {
    return NextResponse.json(
      {
        error: {
          code: "MISSING_FIELDS",
          message: "walletAddress, signature, and nonce are required",
        },
      },
      { status: 400 },
    )
  }

  if (!signature.startsWith("0x") && !/^[A-Za-z0-9+/=]+$/.test(signature)) {
    return NextResponse.json(
      {
        error: {
          code: "INVALID_SIGNATURE_FORMAT",
          message: "Invalid signature encoding",
        },
      },
      { status: 400 },
    )
  }

  const challenge = (await getChallenge(walletAddress, nonce)) as {
    _id: string
    expiresAt: Date
    used: boolean
  } | null

  if (!challenge || challenge.used) {
    return NextResponse.json(
      {
        error: {
          code: "INVALID_CHALLENGE",
          message: "Challenge not found or already used",
        },
      },
      { status: 401 },
    )
  }

  if (new Date() > challenge.expiresAt) {
    return NextResponse.json(
      {
        error: { code: "CHALLENGE_EXPIRED", message: "Challenge has expired" },
      },
      { status: 401 },
    )
  }

  const message = `Sign this message to authenticate with Climate Prediction Market.\n\nWallet: ${walletAddress}\nNonce: ${nonce}`
  const messageBytes = new TextEncoder().encode(message)

  let verified = false
  try {
    if (signature.startsWith("0x")) {
      const sigHex = signature.slice(2)
      if (sigHex.length === 128) {
        const sigBytes = hexToBytes(sigHex)
        const pubKeyBytes = bs58.decode(walletAddress)
        verified = nacl.sign.detached.verify(
          messageBytes,
          sigBytes,
          pubKeyBytes,
        )
      }
    } else {
      const sigBytes = bs58.decode(signature)
      const pubKeyBytes = bs58.decode(walletAddress)
      verified = nacl.sign.detached.verify(messageBytes, sigBytes, pubKeyBytes)
    }
  } catch {
    verified = false
  }

  if (!verified) {
    return NextResponse.json(
      {
        error: {
          code: "INVALID_SIGNATURE",
          message: "Signature verification failed",
        },
      },
      { status: 401 },
    )
  }

  await markChallengeUsed(challenge._id)

  await upsertUser(walletAddress)

  const token = await signJwt({ sub: walletAddress, wallet: walletAddress })

  return NextResponse.json({
    data: {
      token,
      walletAddress,
      expiresIn: "7d",
    },
  })
}
