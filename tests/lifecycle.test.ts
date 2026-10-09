import { createHash } from "node:crypto"
import { describe, expect, it } from "vitest"
import { Keypair, PublicKey } from "@solana/web3.js"

import {
  __useProgramIdForTests,
  buildCloseMarket,
  buildResolveMarket,
  instructionDiscriminator,
  modelOddsOf,
  resolveDraw,
  RESOLUTION_DECISIONS,
} from "@/scripts/lifecycle.mjs"

const PROGRAM_ID = new PublicKey(
  "EkcwkAzNUCGRcKCA5WJc7GCtUXooubkm3ktesBWQXPBt",
)
__useProgramIdForTests(PROGRAM_ID)

const PROTOCOL = new PublicKey("9wFjuU9SWcZ3NtwYi4nsArMzNCtY6fyAZHNxQtU74Fsy")
const MARKET = Keypair.generate().publicKey
const SIGNER = Keypair.generate().publicKey

describe("instruction builders", () => {
  it("encodes close_market with the anchor discriminator and 3 accounts", () => {
    const ix = buildCloseMarket(PROTOCOL, MARKET, SIGNER)
    expect(ix.programId.equals(PROGRAM_ID)).toBe(true)
    expect(ix.keys.map((k) => k.pubkey.toBase58())).toEqual([
      PROTOCOL.toBase58(),
      MARKET.toBase58(),
      SIGNER.toBase58(),
    ])
    expect(ix.keys[0]).toMatchObject({ isSigner: false, isWritable: false })
    expect(ix.keys[1]).toMatchObject({ isSigner: false, isWritable: true })
    expect(ix.keys[2]).toMatchObject({ isSigner: true })
    const expected = createHash("sha256")
      .update("global:close_market")
      .digest()
      .subarray(0, 8)
    expect(Buffer.from(ix.data.subarray(0, 8)).equals(expected)).toBe(true)
    expect(ix.data.length).toBe(8)
  })

  it("encodes resolve_market with the decision byte", () => {
    for (const byte of Object.values(RESOLUTION_DECISIONS)) {
      const ix = buildResolveMarket(PROTOCOL, MARKET, SIGNER, byte)
      expect(ix.programId.equals(PROGRAM_ID)).toBe(true)
      expect(ix.keys).toHaveLength(3)
      expect(ix.keys[1]).toMatchObject({ isSigner: false, isWritable: true })
      const expected = createHash("sha256")
        .update("global:resolve_market")
        .digest()
        .subarray(0, 8)
      expect(Buffer.from(ix.data.subarray(0, 8)).equals(expected)).toBe(true)
      expect(ix.data[8]).toBe(byte)
      expect(ix.data.length).toBe(9)
    }
    expect(RESOLUTION_DECISIONS).toEqual({ yes: 0, no: 1, cancelled: 2 })
  })

  it("derives discriminators independently", () => {
    for (const name of ["close_market", "resolve_market"]) {
      const expected = createHash("sha256")
        .update(`global:${name}`)
        .digest()
        .subarray(0, 8)
      expect(
        Buffer.from(instructionDiscriminator(name)).equals(expected),
      ).toBe(true)
    }
  })
})

describe("resolveDraw", () => {
  it("is deterministic per market id", () => {
    expect(resolveDraw("m1", 0.6)).toBe(resolveDraw("m1", 0.6))
    const outcomes = new Set(
      Array.from({ length: 20 }, (_, i) => resolveDraw(`m${i}`, 0.6)),
    )
    expect(outcomes.size).toBeGreaterThan(1)
  })

  it("only emits yes or no", () => {
    for (let i = 0; i < 50; i++) {
      expect(["yes", "no"]).toContain(resolveDraw(`q${i}`, 0.13 + (i % 70) / 100))
    }
  })
})

describe("modelOddsOf", () => {
  const base = { marketId: "m", yesPrice: 0.7 }

  it("prefers the tape opening point", () => {
    expect(
      modelOddsOf({ ...base, history: [{ yesProbability: 0.22 }] }),
    ).toBeCloseTo(0.22, 5)
  })

  it("falls back to yesPrice, then 0.5, clamped", () => {
    expect(modelOddsOf(base)).toBeCloseTo(0.7, 5)
    expect(modelOddsOf({ marketId: "m" })).toBe(0.5)
    expect(modelOddsOf({ ...base, history: [{ yesProbability: 0.9999 }] })).toBe(0.95)
    expect(modelOddsOf({ ...base, history: [{ yesProbability: 0.0001 }] })).toBe(0.05)
  })
})
