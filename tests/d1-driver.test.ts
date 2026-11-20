import { DatabaseSync } from "node:sqlite"
import { beforeEach, describe, expect, it } from "vitest"

import {
  __resetStoreForTests,
  existingMarketIds,
  findTransactionBySignature,
  getChallenge,
  getMarketByIdOrSlug,
  insertChallenge,
  insertPosition,
  insertTransaction,
  listMarkets,
  openD1Store,
  settlePositionsByMarket,
  upsertMarket,
  upsertUser,
} from "@/lib/db/store.mjs"

/**
 * Minimal D1Database stand-in backed by real in-memory SQLite. It mirrors
 * the parts of the Workers API the store uses: prepare/bind/run/all/first/
 * batch/exec, including D1's `{ meta: { changes, last_row_id } }` shape.
 */
interface FakeStatement {
  bind(...params: unknown[]): FakeStatement
  run(): Promise<{
    success: boolean
    meta: { changes: number; last_row_id: number | bigint | null }
  }>
  all(): Promise<{ success: boolean; results: Array<Record<string, unknown>> }>
  first(): Promise<Record<string, unknown> | null>
}

function createFakeD1() {
  const sqlite = new DatabaseSync(":memory:")
  sqlite.exec("PRAGMA foreign_keys=ON")

  const statement = (sql: string, params: unknown[]): FakeStatement => ({
    bind: (...next: unknown[]) => statement(sql, next),
    run: async () => {
      const info = sqlite.prepare(sql).run(...(params as never[]))
      return {
        success: true,
        meta: {
          changes: Number(info.changes),
          last_row_id: info.lastInsertRowid,
        },
      }
    },
    all: async () => ({
      success: true,
      results: sqlite.prepare(sql).all(...(params as never[])) as Array<
        Record<string, unknown>
      >,
    }),
    first: async () =>
      (sqlite.prepare(sql).get(...(params as never[])) as
        Record<string, unknown> | undefined) ?? null,
  })

  return {
    prepare: (sql: string) => statement(sql, []),
    exec: async (sql: string) => {
      sqlite.exec(sql)
      return { count: 0, duration: 0 }
    },
    batch: async (statements: FakeStatement[]) =>
      Promise.all(statements.map((entry) => entry.all())),
    __sqlite: sqlite,
  }
}

function marketInput(id: string, overrides: Record<string, unknown> = {}) {
  return {
    marketId: id,
    onchainMarketId: 5001,
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
    evidence: [{ id: "e1" }],
    recentTrades: [],
    createdAt: "2025-01-01T00:00:00.000Z",
    closeTime: "2027-01-01T00:00:00.000Z",
    resolutionTime: "2027-01-15T00:00:00.000Z",
    ...overrides,
  }
}

beforeEach(async () => {
  await __resetStoreForTests()
  const binding = createFakeD1()
  await openD1Store(binding as unknown)
})

describe("D1 driver", () => {
  it("creates the schema on first open and hydrates market pages", async () => {
    await upsertMarket(marketInput("m1", { trendingScore: 90 }))
    await upsertMarket(
      marketInput("m2", {
        onchainMarketId: 5002,
        slug: "m2-slug",
        trendingScore: 10,
      }),
    )

    const page = await listMarkets({ limit: 10 })
    expect(page.total).toBe(2)
    expect(page.markets.map((market) => market.marketId)).toEqual(["m1", "m2"])
    // Hydration fields come from the batch query, not per-row reads.
    expect(page.markets[0]!.history).toEqual([])
    expect(page.markets[0]!.participants).toBe(0)
    expect(page.markets[0]!.evidence).toEqual([{ id: "e1" }])
  })

  it("maps last_row_id and changes through the D1 meta shape", async () => {
    const challenge = await insertChallenge("wallet-1", "nonce-1", 60_000)
    expect(Number(challenge._id)).toBeGreaterThan(0)

    const found = await getChallenge("wallet-1", "nonce-1")
    expect(found?.nonce).toBe("nonce-1")
    expect(found?.used).toBe(false)

    const inserted = await insertTransaction({
      walletAddress: "wallet-1",
      type: "purchase_yes",
      amountSol: 0.1,
      amountLamports: "100000000",
      txSignature: "sig-d1",
      status: "confirmed",
      marketDocId: "m1",
    })
    expect(inserted.inserted).toBe(true)

    const duplicate = await insertTransaction({
      walletAddress: "wallet-1",
      type: "purchase_yes",
      amountSol: 0.1,
      amountLamports: "100000000",
      txSignature: "sig-d1",
      status: "confirmed",
      marketDocId: "m1",
    })
    expect(duplicate.inserted).toBe(false)
    expect((await findTransactionBySignature("sig-d1"))?._id).toBe(
      inserted.doc._id,
    )
  })

  it("chunks IN lists beyond D1's bound-parameter limit", async () => {
    await upsertMarket(marketInput("keep"))
    const ids = Array.from({ length: 120 }, (_, i) => `missing-${i}`)
    ids.splice(3, 0, "keep")
    expect(await existingMarketIds(ids)).toEqual(["keep"])
  })

  it("settles positions and reports changed rows", async () => {
    await upsertUser("wallet-2")
    await insertPosition({
      walletAddress: "wallet-2",
      marketDocId: "m1",
      onchainMarketId: 5001,
      marketQuestion: "Q?",
      side: "yes",
      amountSol: 1,
      amountLamports: "1000000000",
      estimatedPayoutSol: 2,
      estimatedPayoutLamports: "2000000000",
      txSignature: "pos-1",
    })
    await insertPosition({
      walletAddress: "wallet-2",
      marketDocId: "m1",
      onchainMarketId: 5001,
      marketQuestion: "Q?",
      side: "no",
      amountSol: 1,
      amountLamports: "1000000000",
      estimatedPayoutSol: 2,
      estimatedPayoutLamports: "2000000000",
      txSignature: "pos-2",
    })

    const settled = await settlePositionsByMarket("m1", "yes")
    expect(settled).toEqual({ won: 1, lost: 1 })
  })

  it("reads a market by slug through the D1 driver", async () => {
    await upsertMarket(marketInput("m9"))
    const doc = await getMarketByIdOrSlug("m9-slug")
    expect(doc?.marketId).toBe("m9")
    expect(await getMarketByIdOrSlug("nope")).toBeNull()
  })
})
