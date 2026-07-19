import { beforeEach, describe, expect, it, vi } from "vitest"

import { POST as indexTransaction } from "@/app/api/index-transaction/route"
import { GET as getMarket } from "@/app/api/markets/[id]/route"
import { GET as getRegionMarkets } from "@/app/api/markets/region/[continent]/route"
import { GET as getMarkets } from "@/app/api/markets/route"
import { GET as getActivity } from "@/app/api/users/[wallet]/activity/route"
import { GET as getPositions } from "@/app/api/users/[wallet]/positions/route"
import {
  DEMO_WALLETS,
  demoMarkets,
  demoUserActivity,
  demoUserPositions,
} from "@/lib/markets/data"
import type { MarketListQuery } from "@/lib/markets/types"

const dbMocks = vi.hoisted(() => ({
  getActivityByWallet: vi.fn(),
  getMarketById: vi.fn(),
  getMarketsByContinent: vi.fn(),
  getPositionsByWalletForApi: vi.fn(),
  initDb: vi.fn(),
  insertPosition: vi.fn(),
  insertPriceSnapshot: vi.fn(),
  insertTransaction: vi.fn(),
  queryMarkets: vi.fn(),
}))

vi.mock("@/lib/db/init", () => ({ initDb: dbMocks.initDb }))

vi.mock("@/lib/db/repositories/markets", () => ({
  getMarketById: dbMocks.getMarketById,
  getMarketsByContinent: dbMocks.getMarketsByContinent,
  queryMarkets: dbMocks.queryMarkets,
}))

vi.mock("@/lib/db/repositories/positions", () => ({
  getPositionsByWalletForApi: dbMocks.getPositionsByWalletForApi,
  insertPosition: dbMocks.insertPosition,
}))

vi.mock("@/lib/db/repositories/marketPrices", () => ({
  insertPriceSnapshot: dbMocks.insertPriceSnapshot,
}))

vi.mock("@/lib/db/repositories/transactions", () => ({
  getActivityByWallet: dbMocks.getActivityByWallet,
  insertTransaction: dbMocks.insertTransaction,
}))

const DEMO_RESOLUTION_SIGNATURE = "aqcDTRNkJKwcprcwLbCSkXWyUKBXGmYA63iJrEwksaXg5zte76RQ6b2HEXNJp4QQ1tpqWVXaYGtYu2F9mjDuTRM"

interface ErrorBody {
  error: { code: string; message: string }
  meta: { network: string }
}

beforeEach(() => {
  vi.clearAllMocks()
  dbMocks.initDb.mockResolvedValue(undefined)

  dbMocks.queryMarkets.mockImplementation(async (query: MarketListQuery) => {
    const matches = demoMarkets.filter(
      (market) =>
        (!query.category || market.category === query.category) &&
        (!query.status || market.status === query.status),
    )
    const limit = query.limit ?? 100
    const offset = query.offset ?? 0
    return {
      markets: matches.slice(offset, offset + limit),
      total: matches.length,
      limit,
      offset,
    }
  })
  dbMocks.getMarketById.mockImplementation(async (id: string) =>
    demoMarkets.find((market) => market.id === id || market.slug === id),
  )
  dbMocks.getMarketsByContinent.mockImplementation(
    async (continent: string, query: Partial<MarketListQuery>) => {
      const continentName =
        continent === "north-america" ? "North America" : continent
      const matches = demoMarkets.filter(
        (market) =>
          market.continent === continentName &&
          (!query.status || market.status === query.status),
      )
      const limit = query.limit ?? 100
      const offset = query.offset ?? 0
      return {
        markets: matches.slice(offset, offset + limit),
        total: matches.length,
        limit,
        offset,
      }
    },
  )
  dbMocks.getPositionsByWalletForApi.mockImplementation(
    async (wallet: string) =>
      demoUserPositions.filter((position) => position.wallet === wallet),
  )
  dbMocks.getActivityByWallet.mockImplementation(async (wallet: string) =>
    demoUserActivity.filter((activity) => activity.wallet === wallet),
  )
  dbMocks.insertTransaction.mockResolvedValue({
    _id: { toHexString: () => "mongo-transaction-id" },
  })
  dbMocks.insertPosition.mockResolvedValue({})
  dbMocks.insertPriceSnapshot.mockResolvedValue(undefined)
})

describe("market API routes", () => {
  it("lists and filters MongoDB-backed markets with consistent metadata", async () => {
    const response = await getMarkets(
      new Request("http://localhost/api/markets?category=drought&status=open"),
    )
    const body = (await response.json()) as {
      data: {
        markets: Array<{ category: string; status: string }>
        total: number
      }
      meta: { network: string }
    }

    expect(response.status).toBe(200)
    expect(body.data.total).toBe(6)
    expect(body.data.markets).toHaveLength(6)
    for (const market of body.data.markets) {
      expect(market).toMatchObject({
        category: "drought",
        status: "open",
      })
    }
    expect(body.meta).toMatchObject({
      network: "devnet",
    })
    expect(dbMocks.initDb).toHaveBeenCalledOnce()
  })

  it("returns structured validation errors", async () => {
    const response = await getMarkets(
      new Request("http://localhost/api/markets?limit=1000"),
    )
    const body = (await response.json()) as ErrorBody

    expect(response.status).toBe(400)
    expect(body.error.code).toBe("VALIDATION_ERROR")
    expect(body.meta.network).toBe("devnet")
    expect(dbMocks.queryMarkets).not.toHaveBeenCalled()
  })

  it("gets a market by slug and returns a typed not-found response", async () => {
    const found = await getMarket(new Request("http://localhost"), {
      params: Promise.resolve({ id: "florida-category-4-hurricane-2026-demo" }),
    })
    const foundBody = (await found.json()) as {
      data: { id: string }
    }
    expect(foundBody.data.id).toBe("demo-fl-hurricane-2026")

    const missing = await getMarket(new Request("http://localhost"), {
      params: Promise.resolve({ id: "missing-market" }),
    })
    const missingBody = (await missing.json()) as ErrorBody
    expect(missing.status).toBe(404)
    expect(missingBody.error.code).toBe("MARKET_NOT_FOUND")
  })

  it("passes slug-based region and status filters to the repository", async () => {
    const response = await getRegionMarkets(
      new Request(
        "http://localhost/api/markets/region/north-america?status=open",
      ),
      { params: Promise.resolve({ continent: "north-america" }) },
    )
    const body = (await response.json()) as {
      data: {
        markets: Array<{ status: string }>
        total: number
      }
    }

    expect(response.status).toBe(200)
    expect(body.data.total).toBeGreaterThanOrEqual(2)
    expect(body.data.markets.every((market) => market.status === "open")).toBe(
      true,
    )
    expect(dbMocks.getMarketsByContinent).toHaveBeenCalledWith(
      "north-america",
      expect.objectContaining({ status: "open" }),
    )
  })
})

describe("wallet and transaction API routes", () => {
  it("returns positions for a valid wallet and rejects malformed keys", async () => {
    const response = await getPositions(new Request("http://localhost"), {
      params: Promise.resolve({ wallet: DEMO_WALLETS.atlas }),
    })
    const body = (await response.json()) as {
      data: { positions: unknown[]; total: number }
    }
    expect(response.status).toBe(200)
    expect(body.data.positions).toHaveLength(body.data.total)
    expect(body.data.total).toBeGreaterThan(0)

    const invalid = await getPositions(new Request("http://localhost"), {
      params: Promise.resolve({ wallet: "not-a-solana-key" }),
    })
    const invalidBody = (await invalid.json()) as ErrorBody
    expect(invalid.status).toBe(400)
    expect(invalidBody.error.code).toBe("VALIDATION_ERROR")
  })

  it("rejects malformed JSON before writing transaction records", async () => {
    const response = await indexTransaction(
      new Request("http://localhost/api/index-transaction", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{",
      }),
    )
    const body = (await response.json()) as ErrorBody

    expect(response.status).toBe(400)
    expect(body.error.code).toBe("INVALID_JSON")
    expect(dbMocks.insertTransaction).not.toHaveBeenCalled()
  })

  it("indexes valid metadata idempotently and exposes it in wallet activity", async () => {
    const signature = DEMO_RESOLUTION_SIGNATURE
    const payload = {
      wallet: DEMO_WALLETS.boreal,
      marketId: "demo-fl-hurricane-2026",
      onchainMarketId: 1001,
      type: "purchase_no",
      status: "confirmed",
      side: "no",
      amountLamports: "125000000",
      transactionSignature: signature,
      timestamp: "2026-07-18T03:00:00.000Z",
    }
    const response = await indexTransaction(
      new Request("http://localhost/api/index-transaction", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }),
    )
    const body = (await response.json()) as {
      data: { id: string; signature: string }
    }

    expect(response.status).toBe(200)
    expect(body.data).toEqual({
      id: "mongo-transaction-id",
      signature,
    })
    expect(dbMocks.insertTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        walletAddress: DEMO_WALLETS.boreal,
        type: "purchase_no",
        amountSol: 0.125,
      }),
    )
    expect(dbMocks.insertPosition).toHaveBeenCalledOnce()
    expect(dbMocks.insertPriceSnapshot).toHaveBeenCalledOnce()

    dbMocks.getActivityByWallet.mockResolvedValue([
      {
        ...demoUserActivity[0],
        wallet: DEMO_WALLETS.boreal,
        transactionSignature: signature,
      },
    ])
    const activity = await getActivity(new Request("http://localhost"), {
      params: Promise.resolve({ wallet: DEMO_WALLETS.boreal }),
    })
    const activityBody = (await activity.json()) as {
      data: { activity: Array<{ transactionSignature: string }> }
    }
    expect(activityBody.data.activity).toEqual([
      expect.objectContaining({ transactionSignature: signature }),
    ])
  })
})
