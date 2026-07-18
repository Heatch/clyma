import { NextResponse } from "next/server"
import { PublicKey } from "@solana/web3.js"
import nacl from "tweetnacl"
import bs58 from "bs58"
import { getAuthChallengesCollection } from "@/lib/db/collections"
import { getUsersCollection } from "@/lib/db/collections"
import { signJwt } from "@/lib/auth"

export async function POST(request: Request) {
  let body: { walletAddress?: string; signature?: string; nonce?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { error: { code: "INVALID_JSON", message: "Request body must be valid JSON" } },
      { status: 400 },
    )
  }

  const { walletAddress, signature, nonce } = body
  if (!walletAddress || !signature || !nonce) {
    return NextResponse.json(
      { error: { code: "MISSING_FIELDS", message: "walletAddress, signature, and nonce are required" } },
      { status: 400 },
    )
  }

  if (!signature.startsWith("0x") && !/^[A-Za-z0-9+/=]+$/.test(signature)) {
    return NextResponse.json(
      { error: { code: "INVALID_SIGNATURE_FORMAT", message: "Invalid signature encoding" } },
      { status: 400 },
    )
  }

  const challenges = await getAuthChallengesCollection()
  const challenge = await challenges.findOne({
    walletAddress,
    nonce,
    used: false,
  })

  if (!challenge) {
    return NextResponse.json(
      { error: { code: "INVALID_CHALLENGE", message: "Challenge not found or already used" } },
      { status: 401 },
    )
  }

  if (new Date() > challenge.expiresAt) {
    return NextResponse.json(
      { error: { code: "CHALLENGE_EXPIRED", message: "Challenge has expired" } },
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
        const sigBytes = Buffer.from(sigHex, "hex")
        const pubKeyBytes = new PublicKey(walletAddress).toBytes()
        verified = nacl.sign.detached.verify(messageBytes, sigBytes, pubKeyBytes)
      }
    } else {
      const sigBytes = bs58.decode(signature)
      const pubKeyBytes = new PublicKey(walletAddress).toBytes()
      verified = nacl.sign.detached.verify(messageBytes, sigBytes, pubKeyBytes)
    }
  } catch {
    verified = false
  }

  if (!verified) {
    return NextResponse.json(
      { error: { code: "INVALID_SIGNATURE", message: "Signature verification failed" } },
      { status: 401 },
    )
  }

  await challenges.updateOne(
    { _id: challenge._id },
    { $set: { used: true } },
  )

  const users = await getUsersCollection()
  await users.updateOne(
    { walletAddress },
    {
      $setOnInsert: { walletAddress, createdAt: new Date() },
      $set: { lastLoginAt: new Date() },
    },
    { upsert: true },
  )

  const token = await signJwt({ sub: walletAddress, wallet: walletAddress })

  return NextResponse.json({
    data: {
      token,
      walletAddress,
      expiresIn: "7d",
    },
  })
}
