import { beforeEach, describe, expect, it } from "vitest"

import { getPositionsByWalletForApi } from "@/lib/db/repositories/positions"
import { getActivityByWallet } from "@/lib/db/repositories/transactions"
import {
  __resetStoreForTests,
  existingMarketIds,
  insertPosition,
  insertTransaction,
  openStore,
  upsertMarket,
} from "@/lib/db/store.mjs"

function marketInput(id: string) {
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
  }
}

beforeEach(() => {
  __resetStoreForTests()
  openStore(":memory:")
  upsertMarket(marketInput("m1"))

  // Current-market rows.
  insertPosition({
    walletAddress: "w1",
    marketDocId: "m1",
    onchainMarketId: 3001,
    marketQuestion: "Q m1?",
    side: "yes",
    amountSol: 1,
    amountLamports: "1000000000",
    estimatedPayoutSol: 2,
    estimatedPayoutLamports: "2000000000",
    txSignature: "sig-current",
  })
  insertTransaction({
    walletAddress: "w1",
    type: "purchase_yes",
    amountSol: 1,
    amountLamports: "1000000000",
    txSignature: "sig-current",
    status: "confirmed",
    marketDocId: "m1",
    onchainMarketId: 3001,
  })

  // Stale rows: market deleted by a reseed.
  insertPosition({
    walletAddress: "w1",
    marketDocId: "ghost-market",
    onchainMarketId: 1001,
    marketQuestion: "Old?",
    side: "no",
    amountSol: 2,
    amountLamports: "2000000000",
    estimatedPayoutSol: 3,
    estimatedPayoutLamports: "3000000000",
    txSignature: "sig-stale",
  })
  insertTransaction({
    walletAddress: "w1",
    type: "purchase_no",
    amountSol: 2,
    amountLamports: "2000000000",
    txSignature: "sig-stale",
    status: "confirmed",
    marketDocId: "ghost-market",
    onchainMarketId: 1001,
  })
})

describe("stale market filtering", () => {
  it("resolves only ids present in the markets table", () => {
    expect(existingMarketIds(["m1", "ghost-market", ""])).toEqual(["m1"])
    expect(existingMarketIds([])).toEqual([])
  })

  it("hides positions whose market is gone", async () => {
    const positions = await getPositionsByWalletForApi("w1")
    expect(positions).toHaveLength(1)
    expect(positions[0]?.marketId).toBe("m1")
  })

  it("hides activity whose market is gone, keeps market-less rows", async () => {
    insertTransaction({
      walletAddress: "w1",
      type: "claim",
      txSignature: "sig-marketless",
      status: "confirmed",
    })
    const activity = await getActivityByWallet("w1")
    const sigs = activity.map((item) => item.transactionSignature)
    expect(sigs).toContain("sig-current")
    expect(sigs).toContain("sig-marketless")
    expect(sigs).not.toContain("sig-stale")
  })

  it("returns nothing for unknown wallets", async () => {
    expect(await getPositionsByWalletForApi("nobody")).toEqual([])
    expect(await getActivityByWallet("nobody")).toEqual([])
  })
})
