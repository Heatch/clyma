import { beforeEach, describe, expect, it } from "vitest"

import {
  __resetStoreForTests,
  appendHistoryPoint,
  appendRecentTrades,
  dueToClose,
  dueToResolve,
  findTransactionBySignature,
  getMarketByIdOrSlug,
  incrementActivity,
  insertPosition,
  insertPriceSnapshot,
  insertResolution,
  insertTransaction,
  listMarkets,
  listOpenMarketPools,
  listPositionsByWallet,
  listPriceSnapshots,
  openStore,
  resetMarketData,
  seedParticipants,
  settlePositionsByMarket,
  updateMarketPools,
  updateMarketStatus,
  upsertMarket,
  upsertUser,
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

beforeEach(() => {
  __resetStoreForTests()
  openStore(":memory:")
})

describe("sqlite store", () => {
  it("upserts markets and lists with filters, search, and pagination", () => {
    upsertMarket(marketInput("m1", { category: "drought", trendingScore: 90 }))
    upsertMarket(
      marketInput("m2", {
        category: "flooding",
        trendingScore: 10,
        onchainMarketId: 3002,
        slug: "m2-slug",
      }),
    )
    // Upsert same onchain id updates instead of duplicating.
    upsertMarket(
      marketInput("m1b", { onchainMarketId: 3001, slug: "m1b-slug" }),
    )

    const all = listMarkets({})
    expect(all.total).toBe(2)
    // Trending first.
    expect(all.markets[0]!.marketId).toBe("m1b")

    expect(listMarkets({ category: "flooding" }).total).toBe(1)
    expect(listMarkets({ search: "Q m2" }).total).toBe(1)
    expect(listMarkets({ search: "nonexistent %" }).total).toBe(0)
    const page = listMarkets({ limit: 1, offset: 1 })
    expect(page.markets).toHaveLength(1)
    expect(page.total).toBe(2)
  })

  it("finds markets by id or slug", () => {
    upsertMarket(marketInput("m1"))
    expect(getMarketByIdOrSlug("m1")?.marketId).toBe("m1")
    expect(getMarketByIdOrSlug("m1-slug")?.marketId).toBe("m1")
    expect(getMarketByIdOrSlug("nope")).toBeNull()
  })

  it("appends history capped at 500 points", () => {
    upsertMarket(marketInput("m1"))
    for (let i = 0; i < 505; i++) {
      appendHistoryPoint("m1", {
        timestamp: `2026-01-${String((i % 28) + 1).padStart(2, "0")}T00:00:00.000Z`,
        yesProbability: 0.5,
        noProbability: 0.5,
        totalVolume: i,
        yesLiquidity: i,
        noLiquidity: 0,
      })
    }
    const doc = getMarketByIdOrSlug("m1")
    expect(doc?.history).toHaveLength(500)
  })

  it("tracks volume and unique participants", () => {
    upsertMarket(marketInput("m1"))
    incrementActivity("m1", 0.5, "w1")
    incrementActivity("m1", 0.25, "w1")
    const r = incrementActivity("m1", 0.25, "w2")
    expect(r?.participants).toBe(2)
    const doc = getMarketByIdOrSlug("m1")
    expect(doc!.totalVolume).toBeCloseTo(11, 5)
    expect(seedParticipants("m1", ["w3", "w3"])).toBe(1)
    expect(getMarketByIdOrSlug("m1")!.participants).toBe(3)
  })

  it("overwrites pool display fields and lists open pools", () => {
    upsertMarket(marketInput("m1"))
    upsertMarket(
      marketInput("m2", {
        onchainMarketId: 3002,
        slug: "m2-slug",
        status: "closed",
      }),
    )
    updateMarketPools("m1", {
      yesPrice: 0.4,
      noPrice: 0.6,
      yesLiquidity: 0.08,
      noLiquidity: 0.12,
      totalVolume: 0.2,
    })
    const doc = getMarketByIdOrSlug("m1")
    expect(doc).toMatchObject({
      yesPrice: 0.4,
      noPrice: 0.6,
      yesLiquidity: 0.08,
      noLiquidity: 0.12,
      totalVolume: 0.2,
    })
    // Only open markets, ordered by on-chain id.
    expect(listOpenMarketPools()).toEqual([
      {
        marketDocId: "m1",
        onchainMarketId: 3001,
        yesLiquidity: 0.08,
        noLiquidity: 0.12,
      },
    ])
  })

  it("appends recent trades capped at 8", () => {
    upsertMarket(marketInput("m1"))
    const trades = Array.from({ length: 10 }, (_, i) => ({ id: `t${i}` }))
    appendRecentTrades("m1", trades.slice(0, 5))
    appendRecentTrades("m1", trades.slice(5))
    const recent = getMarketByIdOrSlug("m1")?.recentTrades as Array<{
      id: string
    }>
    expect(recent).toHaveLength(8)
    expect(recent.map((t) => t.id)).toEqual([
      "t2",
      "t3",
      "t4",
      "t5",
      "t6",
      "t7",
      "t8",
      "t9",
    ])
  })

  it("inserts transactions idempotently on signature", () => {
    const params = {
      walletAddress: "w1",
      type: "purchase_yes",
      amountSol: 0.1,
      amountLamports: "100000000",
      txSignature: "sig1",
      status: "confirmed",
      marketDocId: "m1",
    }
    const first = insertTransaction(params)
    const second = insertTransaction(params)
    expect(first.inserted).toBe(true)
    expect(second.inserted).toBe(false)
    expect(second.doc._id).toBe(first.doc._id)
    expect(findTransactionBySignature("sig1")?._id).toBe(first.doc._id)
    expect(findTransactionBySignature("missing")).toBeNull()
  })

  it("settles positions by market outcome", () => {
    upsertUser("w1")
    insertPosition({
      walletAddress: "w1",
      marketDocId: "m1",
      onchainMarketId: 3001,
      marketQuestion: "Q?",
      side: "yes",
      amountSol: 1,
      amountLamports: "1000000000",
      estimatedPayoutSol: 2,
      estimatedPayoutLamports: "2000000000",
      txSignature: "s1",
    })
    insertPosition({
      walletAddress: "w1",
      marketDocId: "m1",
      onchainMarketId: 3001,
      marketQuestion: "Q?",
      side: "no",
      amountSol: 1,
      amountLamports: "1000000000",
      estimatedPayoutSol: 2,
      estimatedPayoutLamports: "2000000000",
      txSignature: "s2",
    })
    const { won, lost } = settlePositionsByMarket("m1", "yes")
    expect(won).toBe(1)
    expect(lost).toBe(1)
    const positions = listPositionsByWallet("w1")
    expect(positions.find((p) => p.side === "yes")?.status).toBe("won")
    expect(positions.find((p) => p.side === "no")?.status).toBe("lost")
  })

  it("stores price snapshots and resolutions", () => {
    upsertMarket(marketInput("m1"))
    insertPriceSnapshot({
      marketDocId: "m1",
      yesPrice: 0.6,
      noPrice: 0.4,
      volume: 1,
      triggerEvent: "trade",
      yesLiquidity: 6,
      noLiquidity: 4,
      totalVolume: 11,
    })
    const snaps = listPriceSnapshots(1)
    expect(snaps).toHaveLength(1)
    expect(snaps[0]!.yesPrice).toBe(0.6)
    const res = insertResolution({
      marketDocId: "m1",
      resolvedOutcome: "yes",
      resolverType: "automated",
      resolverWallet: "w9",
    })
    expect(res.resolvedOutcome).toBe("yes")
  })

  it("finds due-to-close and due-to-resolve markets", () => {
    upsertMarket(
      marketInput("open-past", {
        onchainMarketId: 4001,
        slug: "open-past",
        status: "open",
        closeTime: "2020-01-01T00:00:00.000Z",
      }),
    )
    upsertMarket(
      marketInput("closed-past", {
        onchainMarketId: 4002,
        slug: "closed-past",
        status: "closed",
        resolvesAt: "2020-01-01T00:00:00.000Z",
        resolutionTime: "2020-01-01T00:00:00.000Z",
      }),
    )
    upsertMarket(
      marketInput("open-future", {
        onchainMarketId: 4003,
        slug: "open-future",
        closeTime: "2030-01-01T00:00:00.000Z",
      }),
    )
    const now = new Date().toISOString()
    expect(dueToClose(now).map((d) => d.market_id)).toEqual(["open-past"])
    const due = dueToResolve(now)
    expect(due.map((d) => d.marketId)).toEqual(["closed-past"])
    updateMarketStatus("open-past", "closed")
    expect(dueToClose(now)).toHaveLength(0)
  })

  it("resets market data", () => {
    upsertMarket(marketInput("m1"))
    resetMarketData()
    expect(listMarkets({}).total).toBe(0)
  })
})
