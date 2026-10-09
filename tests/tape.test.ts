import { describe, expect, it } from "vitest"

import {
  buildTape,
  tapeWalletAddress,
} from "@/scripts/lib/tape.mjs"

const INPUT = {
  marketId: "test-tape-market",
  targetYes: 0.63,
  depthSol: 0.065,
  endTime: Date.parse("2026-10-01T00:00:00.000Z"),
}

describe("tape determinism", () => {
  it("produces identical output for identical input", () => {
    expect(buildTape(INPUT)).toEqual(buildTape(INPUT))
  })

  it("differs across market ids", () => {
    const other = buildTape({ ...INPUT, marketId: "test-tape-other" })
    expect(other.trades).not.toEqual(buildTape(INPUT).trades)
  })

  it("derives stable wallet addresses", () => {
    expect(tapeWalletAddress("m", 0)).toBe(tapeWalletAddress("m", 0))
    expect(tapeWalletAddress("m", 0)).not.toBe(tapeWalletAddress("m", 1))
  })
})

describe("tape invariants", () => {
  for (const targetYes of [0.2, 0.5, 0.63, 0.85]) {
    it(`holds for targetYes=${targetYes}`, () => {
      const tape = buildTape({ ...INPUT, targetYes })

      // Σ deposits == final pools, per side, exact integer lamports.
      const yesSum = tape.trades
        .filter((t) => t.side === "yes")
        .reduce((a, t) => a + t.amountLamports, 0)
      const noSum = tape.trades
        .filter((t) => t.side === "no")
        .reduce((a, t) => a + t.amountLamports, 0)
      expect(tape.genesis.yesLamports + yesSum).toBe(tape.pools.yesLamports)
      expect(tape.genesis.noLamports + noSum).toBe(tape.pools.noLamports)
      expect(tape.pools.totalLamports).toBe(
        tape.pools.yesLamports + tape.pools.noLamports,
      )

      // totalVolume == Σ deposits.
      expect(tape.totalVolumeLamports).toBe(tape.pools.totalLamports)

      // Last history point == pool-implied price.
      const last = tape.history[tape.history.length - 1]!
      const implied = tape.pools.yesLamports / tape.pools.totalLamports
      expect(Math.abs(last.yesProbability - implied)).toBeLessThan(1e-4)

      // History opens at genesis (model odds), ends near the target.
      expect(tape.history[0]!.yesProbability).toBeCloseTo(targetYes, 1)
      expect(Math.abs(last.yesProbability - targetYes)).toBeLessThan(0.35)

      // participants == unique wallets.
      expect(tape.participants).toBe(
        new Set(tape.trades.map((t) => t.wallet)).size,
      )
      expect(tape.participants).toBeGreaterThanOrEqual(6)

      // recentTrades == last 8 trades, chronologically ordered.
      expect(tape.recentTrades).toHaveLength(8)
      expect(
        tape.recentTrades.map((t) => `${t.side}:${t.amountLamports}`),
      ).toEqual(
        tape.trades
          .slice(-8)
          .map((t) => `${t.side}:${t.amountLamports}`),
      )

      // Shape ranges: 20–60 trades, ascending timestamps, valid probs.
      expect(tape.tradeCount).toBeGreaterThanOrEqual(20)
      expect(tape.tradeCount).toBeLessThanOrEqual(60)
      const times = tape.history.map((p) => Date.parse(p.timestamp))
      for (let i = 1; i < times.length; i++) {
        expect(times[i]).toBeGreaterThanOrEqual(times[i - 1]!)
      }
      for (const point of tape.history) {
        expect(point.yesProbability).toBeGreaterThanOrEqual(0)
        expect(point.yesProbability).toBeLessThanOrEqual(1)
        expect(
          Math.abs(point.yesProbability + point.noProbability - 1),
        ).toBeLessThan(0.001)
      }

      // Wallets look like real addresses; trades carry real amounts.
      expect(tape.trades[0]!.wallet.length).toBeGreaterThanOrEqual(32)
      for (const trade of tape.trades) {
        expect(trade.amountLamports).toBeGreaterThanOrEqual(5000)
      }
    })
  }

  it("rejects bad input", () => {
    expect(() =>
      buildTape({ marketId: "", targetYes: 0.5, depthSol: 0.05 }),
    ).toThrow()
    expect(() =>
      buildTape({ marketId: "m", targetYes: 0.5, depthSol: 0 }),
    ).toThrow()
  })
})
