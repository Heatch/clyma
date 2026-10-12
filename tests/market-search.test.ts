import { describe, expect, it } from "vitest"

import type { ClimateMarket } from "@/lib/markets/types"
import { matchesSearch, searchRelevance } from "@/lib/markets/search"

function makeMarket(overrides: Partial<ClimateMarket>): ClimateMarket {
  return {
    id: "test",
    onchainMarketId: 1,
    question: "Test question",
    slug: "test",
    description: "Test description",
    category: "wildfire",
    continent: "North America",
    region: "California",
    latitude: 0,
    longitude: 0,
    closeTime: new Date().toISOString(),
    status: "open",
    outcome: "unresolved",
    yesPrice: 0.5,
    noPrice: 0.5,
    yesLiquidity: 1,
    noLiquidity: 1,
    totalVolume: 2,
    participants: 1,
    resolutionSource: "x",
    resolutionSourceUrl: "https://example.com",
    resolutionRules: "x",
    resolver: "x",
    createdAt: new Date().toISOString(),
    featured: false,
    trendingScore: 0,
    history: [],
    evidence: [],
    recentTrades: [],
    network: "devnet",
    settlementAsset: "SOL",
    marketModel: "pooled-binary",
    ...overrides,
  } as ClimateMarket
}

const californiaWildfire = makeMarket({
  id: "ca-fire",
  question:
    "Will the total wildfire acres burned in California during the full 2026 calendar year exceed 1.2 million acres?",
  description: "CAL FIRE tracks statewide acreage.",
  category: "wildfire",
  region: "California",
  country: "United States",
})

describe("matchesSearch", () => {
  it("matches multi-word queries across fields", () => {
    expect(matchesSearch(californiaWildfire, "california fire")).toBe(true)
    expect(matchesSearch(californiaWildfire, "cali fire")).toBe(true)
    expect(matchesSearch(californiaWildfire, "cali wildfire")).toBe(true)
  })

  it("requires every token to match somewhere", () => {
    expect(matchesSearch(californiaWildfire, "california hurricane")).toBe(
      false,
    )
    expect(matchesSearch(californiaWildfire, "california")).toBe(true)
  })

  it("keeps quoted phrases literal", () => {
    expect(matchesSearch(californiaWildfire, '"california fire"')).toBe(false)
    const adjacent = makeMarket({
      question: "Will the california fire season be severe?",
    })
    expect(matchesSearch(adjacent, '"california fire"')).toBe(true)
  })

  it("matches category labels", () => {
    const crops = makeMarket({ category: "crop-yield", region: "Iowa" })
    expect(matchesSearch(crops, "crops")).toBe(true)
    expect(matchesSearch(crops, "crop")).toBe(true)
  })

  it("blank query matches everything", () => {
    expect(matchesSearch(californiaWildfire, "")).toBe(true)
    expect(matchesSearch(californiaWildfire, "   ")).toBe(true)
  })
})

describe("searchRelevance", () => {
  it("ranks question hits above description-only hits", () => {
    const questionHit = makeMarket({
      question: "California wildfire risk",
      region: "Nevada",
      description: "Unrelated description",
    })
    const descriptionHit = makeMarket({
      question: "Unrelated",
      region: "Nevada",
      description: "mentions California once",
    })
    expect(searchRelevance(questionHit, "california")).toBeGreaterThan(
      searchRelevance(descriptionHit, "california"),
    )
  })
})
