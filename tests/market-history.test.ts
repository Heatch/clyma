import { beforeEach, describe, expect, it } from "vitest"

import { getMarketHistory } from "@/lib/db/repositories/markets"
import {
  __resetStoreForTests,
  insertPriceSnapshot,
  openStore,
  replaceHistory,
  upsertMarket,
} from "@/lib/db/store.mjs"

function marketInput(id: string, overrides: Record<string, unknown> = {}) {
  return {
    marketId: id,
    onchainMarketId: 3001,
    slug: `${id}-slug`,
    title: `Q ${id}`,
    question: `Q ${id}?`,
    description: "Description here.",
    category: "drought",
    continent: "Africa",
    region: "Sahel",
    latitude: 0,
    longitude: 0,
    resolutionSource: "WMO",
    resolutionSourceUrl: "https://wmo.int/",
    resolutionRules: "Resolve YES if observed.",
    status: "open",
    outcome: "unresolved",
    yesPrice: 0.6,
    noPrice: 0.4,
    yesLiquidity: 6,
    noLiquidity: 4,
    totalVolume: 10,
    featured: false,
    trendingScore: 50,
    resolver: "r",
    evidence: [],
    recentTrades: [],
    createdAt: "2025-01-01T00:00:00.000Z",
    closeTime: "2027-01-01T00:00:00.000Z",
    resolutionTime: "2027-01-15T00:00:00.000Z",
    ...overrides,
  }
}

const TAPE_HISTORY = [
  {
    timestamp: "2026-01-01T00:00:00.000Z",
    yesProbability: 0.5,
    noProbability: 0.5,
    totalVolume: 8,
    yesLiquidity: 4,
    noLiquidity: 4,
  },
  {
    timestamp: "2026-01-03T00:00:00.000Z",
    yesProbability: 0.6,
    noProbability: 0.4,
    totalVolume: 10,
    yesLiquidity: 6,
    noLiquidity: 4,
  },
]

beforeEach(() => {
  __resetStoreForTests()
  openStore(":memory:")
  upsertMarket(marketInput("m1"))
  replaceHistory("m1", TAPE_HISTORY)
})

describe("getMarketHistory merge", () => {
  it("returns tape history when there are no live snapshots", async () => {
    const result = await getMarketHistory("m1")
    expect(result?.history).toHaveLength(2)
    expect(result?.history[0]?.timestamp).toBe("2026-01-01T00:00:00.000Z")
  })

  it("merges live snapshots in chronological order", async () => {
    insertPriceSnapshot({
      marketDocId: "m1",
      timestamp: "2026-01-02T00:00:00.000Z",
      yesPrice: 0.55,
      noPrice: 0.45,
      volume: 1,
      triggerEvent: "trade",
      yesLiquidity: 5,
      noLiquidity: 4,
      totalVolume: 9,
    })
    const result = await getMarketHistory("m1")
    expect(result?.history.map((p) => p.timestamp)).toEqual([
      "2026-01-01T00:00:00.000Z",
      "2026-01-02T00:00:00.000Z",
      "2026-01-03T00:00:00.000Z",
    ])
    expect(result?.history[1]?.yesProbability).toBe(0.55)
  })

  it("prefers tape points on timestamp ties", async () => {
    insertPriceSnapshot({
      marketDocId: "m1",
      timestamp: "2026-01-03T00:00:00.000Z",
      yesPrice: 0.99,
      noPrice: 0.01,
      volume: 1,
      triggerEvent: "trade",
    })
    const result = await getMarketHistory("m1")
    expect(result?.history).toHaveLength(2)
    expect(result?.history[1]?.yesProbability).toBe(0.6)
  })

  it("returns null for an unknown market", async () => {
    expect(await getMarketHistory("nope")).toBeNull()
  })
})
