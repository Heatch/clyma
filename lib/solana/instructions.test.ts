// @vitest-environment node

import { PublicKey, SystemProgram } from "@solana/web3.js"
import { describe, expect, it } from "vitest"

import {
  buildBuyInstruction,
  buildClaimWinningsInstruction,
  buildCloseMarketInstruction,
  buildCreateMarketInstruction,
  buildFundMarketInstruction,
  buildInitializeProtocolInstruction,
  buildRefundCancelledInstruction,
  buildResolveMarketInstruction,
} from "./instructions"
import {
  deriveMarketPda,
  deriveMarketVaultPda,
  derivePositionPda,
  deriveProgramDataPda,
  deriveProtocolConfigPda,
} from "./pdas"

const programId = new PublicKey("8THvFM9mEZEyzcxgnYU18BS4GNDJqK1Xixkjnuc5yted")
const owner = new PublicKey("11111111111111111111111111111112")
const resolver = new PublicKey("11111111111111111111111111111113")
const marketId = 7

function expectKey(
  actual: { pubkey: PublicKey; isSigner: boolean; isWritable: boolean },
  pubkey: PublicKey,
  isSigner: boolean,
  isWritable: boolean,
): void {
  expect(actual.pubkey.equals(pubkey)).toBe(true)
  expect(actual.isSigner).toBe(isSigner)
  expect(actual.isWritable).toBe(isWritable)
}

describe("climate market instructions", () => {
  it("encodes protocol initialization with upgrade-authority proof accounts", () => {
    const instruction = buildInitializeProtocolInstruction({
      programId,
      authority: owner,
      resolver,
    })
    const [protocol] = deriveProtocolConfigPda(programId)
    const [programData] = deriveProgramDataPda(programId)

    expect([...instruction.data.subarray(0, 8)]).toEqual([
      188, 233, 252, 106, 134, 146, 202, 91,
    ])
    expect(instruction.data.subarray(8).equals(resolver.toBuffer())).toBe(true)
    expect(instruction.keys).toHaveLength(5)
    expectKey(instruction.keys[0]!, protocol, false, true)
    expectKey(instruction.keys[1]!, owner, true, true)
    expectKey(instruction.keys[2]!, programId, false, false)
    expectKey(instruction.keys[3]!, programData, false, false)
    expectKey(instruction.keys[4]!, SystemProgram.programId, false, false)
  })

  it("rejects a default resolver before building protocol initialization", () => {
    expect(() =>
      buildInitializeProtocolInstruction({
        programId,
        authority: owner,
        resolver: PublicKey.default,
      }),
    ).toThrow("Resolver must not be the default public key")
  })

  it("encodes market creation and derives the protocol, market, and vault PDAs", () => {
    const questionHash = Uint8Array.from(
      { length: 32 },
      (_, index) => index + 1,
    )
    const closeTimestamp = 1_800_000_000n
    const resolutionTimestamp = 1_800_003_600n
    const instruction = buildCreateMarketInstruction({
      programId,
      authority: owner,
      marketId,
      questionHash,
      closeTimestamp,
      resolutionTimestamp,
    })
    const [protocol] = deriveProtocolConfigPda(programId)
    const [market] = deriveMarketPda(programId, marketId)
    const [vault] = deriveMarketVaultPda(programId, market)

    expect([...instruction.data.subarray(0, 8)]).toEqual([
      103, 226, 97, 235, 200, 188, 251, 254,
    ])
    expect(instruction.data.readBigUInt64LE(8)).toBe(7n)
    expect([...instruction.data.subarray(16, 48)]).toEqual([...questionHash])
    expect(instruction.data.readBigInt64LE(48)).toBe(closeTimestamp)
    expect(instruction.data.readBigInt64LE(56)).toBe(resolutionTimestamp)
    expect(instruction.data).toHaveLength(64)
    expectKey(instruction.keys[0]!, protocol, false, true)
    expectKey(instruction.keys[1]!, market, false, true)
    expectKey(instruction.keys[2]!, vault, false, true)
    expectKey(instruction.keys[3]!, owner, true, true)
    expectKey(instruction.keys[4]!, SystemProgram.programId, false, false)
  })

  it("rejects malformed market creation fields", () => {
    const validInput = {
      programId,
      authority: owner,
      marketId,
      questionHash: new Uint8Array(32).fill(1),
      closeTimestamp: 100,
      resolutionTimestamp: 101,
    }

    expect(() =>
      buildCreateMarketInstruction({
        ...validInput,
        questionHash: new Uint8Array(31),
      }),
    ).toThrow("exactly 32 bytes")
    expect(() =>
      buildCreateMarketInstruction({
        ...validInput,
        questionHash: new Uint8Array(32),
      }),
    ).toThrow("must not be all zeroes")
    expect(() =>
      buildCreateMarketInstruction({
        ...validInput,
        questionHash: [...new Uint8Array(31).fill(1), 256],
      }),
    ).toThrow("only byte values")
    expect(() =>
      buildCreateMarketInstruction({
        ...validInput,
        resolutionTimestamp: 99,
      }),
    ).toThrow("greater than or equal")
    expect(() =>
      buildCreateMarketInstruction({
        ...validInput,
        closeTimestamp: 1n << 63n,
        resolutionTimestamp: 1n << 63n,
      }),
    ).toThrow("signed 64-bit integer")
    expect(() =>
      buildCreateMarketInstruction({
        ...validInput,
        closeTimestamp: "not-a-timestamp",
      }),
    ).toThrow("must be an integer")
  })

  it("encodes two-sided market funding with funder position PDAs", () => {
    const instruction = buildFundMarketInstruction({
      programId,
      funder: owner,
      marketId,
      yesAmountLamports: 500n,
      noAmountLamports: 750n,
    })
    const [protocol] = deriveProtocolConfigPda(programId)
    const [market] = deriveMarketPda(programId, marketId)
    const [vault] = deriveMarketVaultPda(programId, market)
    const [yesPosition] = derivePositionPda(programId, market, owner, "yes")
    const [noPosition] = derivePositionPda(programId, market, owner, "no")

    expect([...instruction.data.subarray(0, 8)]).toEqual([
      173, 177, 32, 57, 20, 248, 119, 160,
    ])
    expect(instruction.data.readBigUInt64LE(8)).toBe(500n)
    expect(instruction.data.readBigUInt64LE(16)).toBe(750n)
    expect(instruction.data).toHaveLength(24)
    expectKey(instruction.keys[0]!, protocol, false, false)
    expectKey(instruction.keys[1]!, market, false, true)
    expectKey(instruction.keys[2]!, vault, false, true)
    expectKey(instruction.keys[3]!, yesPosition, false, true)
    expectKey(instruction.keys[4]!, noPosition, false, true)
    expectKey(instruction.keys[5]!, owner, true, true)
    expectKey(instruction.keys[6]!, SystemProgram.programId, false, false)
  })

  it("rejects zero and overflowing aggregate market funding", () => {
    expect(() =>
      buildFundMarketInstruction({
        programId,
        funder: owner,
        marketId,
        yesAmountLamports: 0,
        noAmountLamports: 0,
      }),
    ).toThrow("greater than zero")
    expect(() =>
      buildFundMarketInstruction({
        programId,
        funder: owner,
        marketId,
        yesAmountLamports: 18_446_744_073_709_551_615n,
        noAmountLamports: 1,
      }),
    ).toThrow("Combined market funding must fit in a u64")
  })

  it("encodes permissionless market closure with read-only signer metadata", () => {
    const instruction = buildCloseMarketInstruction({
      programId,
      closer: owner,
      marketId,
    })
    const [protocol] = deriveProtocolConfigPda(programId)
    const [market] = deriveMarketPda(programId, marketId)

    expect([...instruction.data]).toEqual([88, 154, 248, 186, 48, 14, 123, 244])
    expect(instruction.keys).toHaveLength(3)
    expectKey(instruction.keys[0]!, protocol, false, false)
    expectKey(instruction.keys[1]!, market, false, true)
    expectKey(instruction.keys[2]!, owner, true, false)
  })

  it.each([
    ["yes", 0],
    ["no", 1],
    ["cancelled", 2],
  ] as const)("encodes the %s resolution decision", (decision, variant) => {
    const instruction = buildResolveMarketInstruction({
      programId,
      resolver,
      marketId,
      decision,
    })
    const [protocol] = deriveProtocolConfigPda(programId)
    const [market] = deriveMarketPda(programId, marketId)

    expect([...instruction.data.subarray(0, 8)]).toEqual([
      155, 23, 80, 173, 46, 74, 23, 239,
    ])
    expect([...instruction.data.subarray(8)]).toEqual([variant])
    expectKey(instruction.keys[0]!, protocol, false, false)
    expectKey(instruction.keys[1]!, market, false, true)
    expectKey(instruction.keys[2]!, resolver, true, false)
  })

  it("rejects an unsupported resolution decision at runtime", () => {
    expect(() =>
      buildResolveMarketInstruction({
        programId,
        resolver,
        marketId,
        decision: "unknown" as "yes",
      }),
    ).toThrow("must be yes, no, or cancelled")
  })

  it("encodes a buy YES instruction with the Anchor discriminator and u64 amount", () => {
    const instruction = buildBuyInstruction({
      programId,
      owner,
      marketId,
      side: "yes",
      amountLamports: 513n,
    })

    expect([...instruction.data.subarray(0, 8)]).toEqual([
      124, 76, 113, 130, 177, 112, 187, 104,
    ])
    expect([...instruction.data.subarray(8)]).toEqual([1, 2, 0, 0, 0, 0, 0, 0])
    expect(instruction.keys).toHaveLength(7)
    expect(instruction.keys.slice(1, 6).every((key) => key.isWritable)).toBe(
      true,
    )
    expect(instruction.keys[5]?.isSigner).toBe(true)
  })

  it("uses read-only position accounts for settlement", () => {
    const claim = buildClaimWinningsInstruction({
      programId,
      owner,
      marketId,
    })
    const refund = buildRefundCancelledInstruction({
      programId,
      owner,
      marketId,
    })

    expect([...claim.data]).toEqual([161, 215, 24, 59, 14, 236, 242, 221])
    expect([...refund.data]).toEqual([103, 244, 158, 83, 225, 80, 56, 62])
    expect(claim.keys[3]?.isWritable).toBe(false)
    expect(claim.keys[4]?.isWritable).toBe(false)
    expect(refund.keys[3]?.isWritable).toBe(false)
    expect(refund.keys[4]?.isWritable).toBe(false)
    expect(claim.keys[6]?.isSigner).toBe(true)
  })
})
