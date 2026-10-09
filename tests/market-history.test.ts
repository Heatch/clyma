import { beforeEach, describe, expect, it, vi } from "vitest"

import { getMarketHistory } from "@/lib/db/repositories/markets"

const { mockMarkets, mockPrices } = vi.hoisted(() => ({
  mockMarkets: { findOne: vi.fn() },
  mockPrices: { find: vi.fn() },
}))

vi.mock("@/lib/db/collections", () => ({
  getMarketsCollection: async () => mockMarkets,
  getMarketPricesCollection: async () => mockPrices,
}))

function marketDoc() {
  return {
    _id: { toHexString: () => "doc-id" },
    marketId: "m1",
    onchainMarketId: 3001,
    title: "Q",
    question: "Q",
    description: "D",
    slug: "q",
    category: "drought",
    continent: "Africa",
    region: "Sahel",
    latitude: 0,
    longitude: 0,
    resolutionSource: "WMO",
    resolutionSourceUrl: "https://wmo.int/",
    resolutionRules: "Rules",
    status: "open",
    outcome: "unresolved",
    yesPrice: 0.6,
    noPrice: 0.4,
    yesLiquidity: 6,
    noLiquidity: 4,
    totalVolume: 10,
    participants: 5,
    featured: false,
    trendingScore: 50,
    resolver: "3mshx6HoZop71xQ483kLMdiUuXQ1UxDgBABuLnFkVfDV",
    history: [
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
    ],
    evidence: [],
    recentTrades: [],
    openAt: new Date("2025-01-01T00:00:00.000Z"),
    closesAt: new Date("2027-01-01T00:00:00.000Z"),
    resolvesAt: new Date("2027-01-15T00:00:00.000Z"),
    createdAt: new Date("2025-01-01T00:00:00.000Z"),
  }
}

function priceCursor(docs: unknown[]) {
  return {
    sort: () => ({ toArray: async () => docs }),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockMarkets.findOne.mockResolvedValue(marketDoc())
  mockPrices.find.mockReturnValue(priceCursor([]))
})

describe("getMarketHistory merge", () => {
  it("returns embedded history when there are no snapshots", async () => {
    const result = await getMarketHistory("m1")
    expect(result?.history).toHaveLength(2)
    expect(result?.history[0]?.timestamp).toBe("2026-01-01T00:00:00.000Z")
  })

  it("merges live snapshots in chronological order", async () => {
    mockPrices.find.mockReturnValue(
      priceCursor([
        {
          timestamp: new Date("2026-01-02T00:00:00.000Z"),
          yesPrice: 0.55,
          noPrice: 0.45,
          volume: 1,
          yesLiquidity: 5,
          noLiquidity: 4,
          totalVolume: 9,
        },
      ]),
    )
    const result = await getMarketHistory("m1")
    expect(result?.history.map((p) => p.timestamp)).toEqual([
      "2026-01-01T00:00:00.000Z",
      "2026-01-02T00:00:00.000Z",
      "2026-01-03T00:00:00.000Z",
    ])
    expect(result?.history[1]?.yesProbability).toBe(0.55)
  })

  it("prefers embedded points on timestamp ties", async () => {
    mockPrices.find.mockReturnValue(
      priceCursor([
        {
          timestamp: new Date("2026-01-03T00:00:00.000Z"),
          yesPrice: 0.99,
          noPrice: 0.01,
          volume: 1,
        },
      ]),
    )
    const result = await getMarketHistory("m1")
    expect(result?.history).toHaveLength(2)
    expect(result?.history[1]?.yesProbability).toBe(0.6)
  })

  it("returns null for an unknown market", async () => {
    mockMarkets.findOne.mockResolvedValue(null)
    expect(await getMarketHistory("nope")).toBeNull()
  })
})
