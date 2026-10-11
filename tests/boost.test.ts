import { describe, expect, it } from "vitest"

import {
  decodeMarketPools,
  planBoostDepths,
  type BoostPlanEntry,
} from "@/scripts/lifecycle.mjs"

const LAMPORTS = 1_000_000_000

function planBoost(
  n: number,
  opts: {
    targetTotalSol: number
    minDepthSol: number
    maxDepthSol: number
    seedTag: string
  },
): BoostPlanEntry[] {
  return planBoostDepths(synthMarkets(n), opts)
}

function synthMarkets(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    marketDocId: `m${i}`,
    onchainMarketId: 3001 + i,
    // Mirror the live catalogue: ~6.7 SOL across 112 markets, mean ~0.06.
    curYesSol: (0.01 + ((i * 37) % 130) / 1000) / 2.5,
    curNoSol: (0.01 + ((i * 53) % 130) / 1000) / 2.5,
    dbTotalSol: 0,
  }))
}

describe("planBoostDepths", () => {
  it("is deterministic for the same inputs", () => {
    const markets = synthMarkets(112)
    const opts = {
      targetTotalSol: 15,
      minDepthSol: 0.02,
      maxDepthSol: 1.5,
      seedTag: "boost",
    }
    expect(planBoostDepths(markets, opts)).toEqual(
      planBoostDepths(markets, opts),
    )
  })

  it("funded final lands on the target total and never moves the odds", () => {
    const plan = planBoost(112, {
      targetTotalSol: 15,
      minDepthSol: 0.02,
      maxDepthSol: 1.5,
      seedTag: "boost",
    })
    const chainLamports = synthMarkets(112).reduce(
      (a, m) =>
        a +
        Math.round(m.curYesSol * LAMPORTS) +
        Math.round(m.curNoSol * LAMPORTS),
      0,
    )
    const finalLamports =
      chainLamports + plan.reduce((a, p) => a + p.addTotal, 0)
    // Binary search + lamport rounding: final within a dust tolerance.
    expect(Math.abs(finalLamports - 15 * LAMPORTS)).toBeLessThan(10_000)
    for (const p of plan) {
      const before = p.curYes / Math.max(1, p.curTotal)
      const after = p.targetYes / Math.max(1, p.targetTotal)
      expect(Math.abs(before - after)).toBeLessThan(1e-6)
      expect(p.addYes).toBeGreaterThanOrEqual(0)
      expect(p.addNo).toBeGreaterThanOrEqual(0)
      expect(p.addTotal).toBe(p.addYes + p.addNo)
      expect(p.targetTotal).toBe(p.targetYes + p.targetNo)
    }
  })

  it("produces a wide spread, not a flat allocation", () => {
    const spread = planBoost(112, {
      targetTotalSol: 15,
      minDepthSol: 0.02,
      maxDepthSol: 1.5,
      seedTag: "boost",
    })
    const totals = spread.map((p) => p.targetTotal / LAMPORTS)
    const min = Math.min(...totals)
    const max = Math.max(...totals)
    expect(max / min).toBeGreaterThan(5)
    expect(max).toBeLessThanOrEqual(1.6)
    expect(spread.filter((p) => p.addTotal > 0).length).toBeGreaterThan(50)
  })

  it("leaves markets already above target unfunded", () => {
    const single = planBoostDepths(
      [
        {
          marketDocId: "whale",
          onchainMarketId: 9001,
          curYesSol: 5,
          curNoSol: 5,
          dbTotalSol: 10,
        },
      ],
      {
        targetTotalSol: 0.1,
        minDepthSol: 0.02,
        maxDepthSol: 1.5,
        seedTag: "boost",
      },
    )
    expect(single).toHaveLength(1)
    expect(single[0]!.addTotal).toBe(0)
    expect(single[0]!.targetTotal).toBe(Math.round(0.1 * LAMPORTS))
  })

  it("changes with the seed tag", () => {
    const opts = {
      targetTotalSol: 3,
      minDepthSol: 0.02,
      maxDepthSol: 1.5,
    }
    const a = planBoost(20, { ...opts, seedTag: "boost" })
    const b = planBoost(20, { ...opts, seedTag: "other" })
    expect(a).not.toEqual(b)
  })
})

describe("decodeMarketPools", () => {
  it("decodes yes/no/total lamports and status from the account layout", () => {
    const data = Buffer.alloc(204)
    data.writeBigUInt64LE(42_900_000n, 162)
    data.writeBigUInt64LE(35_700_000n, 170)
    data.writeBigUInt64LE(78_600_000n, 178)
    data[160] = 0
    const decoded = decodeMarketPools({ data })
    expect(decoded).toMatchObject({
      yes: 0.0429,
      no: 0.0357,
      total: 0.0786,
      status: 0,
    })
  })

  it("returns null for missing or truncated accounts", () => {
    expect(decodeMarketPools(null)).toBeNull()
    expect(decodeMarketPools(undefined)).toBeNull()
    expect(decodeMarketPools({ data: Buffer.alloc(100) })).toBeNull()
  })
})
