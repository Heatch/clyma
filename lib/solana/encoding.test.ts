// @vitest-environment node

import { describe, expect, it } from "vitest"

import { marketIdToU64, solToLamports, u64ToBuffer } from "./encoding"

describe("Solana amount encoding", () => {
  it("converts SOL strings to lamports without floating-point rounding", () => {
    expect(solToLamports("0.000000001")).toBe(1n)
    expect(solToLamports("1.25")).toBe(1_250_000_000n)
    expect(solToLamports("100")).toBe(100_000_000_000n)
  })

  it("rejects malformed or over-precise amounts", () => {
    expect(() => solToLamports("-1")).toThrow()
    expect(() => solToLamports("1.0000000001")).toThrow()
    expect(() => solToLamports("not-a-number")).toThrow()
  })

  it("encodes u64 values as little-endian bytes", () => {
    expect([...u64ToBuffer(513n)]).toEqual([1, 2, 0, 0, 0, 0, 0, 0])
  })

  it("uses explicit numeric market IDs and stable slug fallbacks", () => {
    expect(marketIdToU64("42")).toBe(42n)
    expect(marketIdToU64("ontario-rainfall")).toBe(
      marketIdToU64("ontario-rainfall"),
    )
    expect(marketIdToU64("ontario-rainfall")).not.toBe(
      marketIdToU64("california-drought"),
    )
  })
})
