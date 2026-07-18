// @vitest-environment node

import { Buffer } from "buffer"
import { PublicKey } from "@solana/web3.js"
import { describe, expect, it } from "vitest"

import {
  decodeClaimRecordAccount,
  decodeMarketAccount,
  decodePositionAccount,
} from "./accounts"

const market = new PublicKey("11111111111111111111111111111112")
const owner = new PublicKey("11111111111111111111111111111113")

describe("Anchor account decoding", () => {
  it("decodes authoritative market pools and settlement state", () => {
    const data = Buffer.alloc(204)
    Buffer.from([219, 190, 213, 55, 0, 227, 198, 154]).copy(data)
    market.toBuffer().copy(data, 8)
    owner.toBuffer().copy(data, 40)
    owner.toBuffer().copy(data, 72)
    data.writeBigUInt64LE(42n, 104)
    Buffer.alloc(32, 7).copy(data, 112)
    data.writeBigInt64LE(1_749_999_000n, 144)
    data.writeBigInt64LE(1_750_000_000n, 152)
    data[160] = 2
    data[161] = 1
    data.writeBigUInt64LE(3_000_000_000n, 162)
    data.writeBigUInt64LE(2_000_000_000n, 170)
    data.writeBigUInt64LE(5_000_000_000n, 178)
    data.writeBigUInt64LE(1_000_000_000n, 186)
    data.writeBigInt64LE(1_750_000_000n, 194)

    expect(decodeMarketAccount(data)).toEqual({
      protocol: market,
      authority: owner,
      resolver: owner,
      marketId: 42n,
      questionHash: Buffer.alloc(32, 7),
      closeTimestamp: 1_749_999_000n,
      resolutionTimestamp: 1_750_000_000n,
      status: "resolved",
      outcome: "yes",
      totalYesAmount: 3_000_000_000n,
      totalNoAmount: 2_000_000_000n,
      totalPoolAmount: 5_000_000_000n,
      totalPaidAmount: 1_000_000_000n,
      resolvedAt: 1_750_000_000n,
    })
  })

  it("decodes wallet position ownership and side", () => {
    const data = Buffer.alloc(82)
    Buffer.from([170, 188, 143, 228, 122, 64, 247, 208]).copy(data)
    market.toBuffer().copy(data, 8)
    owner.toBuffer().copy(data, 40)
    data[72] = 1
    data.writeBigUInt64LE(750_000_000n, 73)

    expect(decodePositionAccount(data)).toEqual({
      market,
      owner,
      side: "no",
      amount: 750_000_000n,
    })
  })

  it("decodes an idempotent refund claim record", () => {
    const data = Buffer.alloc(91)
    Buffer.from([57, 229, 0, 9, 65, 62, 96, 7]).copy(data)
    market.toBuffer().copy(data, 8)
    owner.toBuffer().copy(data, 40)
    data[72] = 1
    data[73] = 1
    data.writeBigUInt64LE(900_000_000n, 74)
    data.writeBigInt64LE(1_750_000_100n, 82)

    expect(decodeClaimRecordAccount(data)).toEqual({
      market,
      owner,
      claimed: true,
      kind: "refund",
      amount: 900_000_000n,
      claimedAt: 1_750_000_100n,
    })
  })

  it("rejects data with the wrong discriminator", () => {
    expect(() => decodeMarketAccount(Buffer.alloc(204))).toThrow(
      /discriminator/i,
    )
  })
})
