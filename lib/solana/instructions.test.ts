// @vitest-environment node
import { PublicKey } from "@solana/web3.js"
import { describe, expect, it } from "vitest"

import {
  buildBuyInstruction,
  buildClaimWinningsInstruction,
  buildRefundCancelledInstruction,
} from "./instructions"

const programId = new PublicKey("8THvFM9mEZEyzcxgnYU18BS4GNDJqK1Xixkjnuc5yted")
const owner = new PublicKey("11111111111111111111111111111112")

describe("climate market instructions", () => {
  it("encodes a buy YES instruction with the Anchor discriminator and u64 amount", () => {
    const instruction = buildBuyInstruction({
      programId,
      owner,
      marketId: 7,
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
      marketId: 7,
    })
    const refund = buildRefundCancelledInstruction({
      programId,
      owner,
      marketId: 7,
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
