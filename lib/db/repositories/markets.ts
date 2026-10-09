import {
  appendHistoryPoint as storeAppendHistoryPoint,
  getMarketByIdOrSlug,
  getRowIdByMarketId,
  incrementActivity as storeIncrementActivity,
  listMarkets as storeListMarkets,
  listMarketsByContinent as storeListByContinent,
  listPriceSnapshots,
  updateMarketStatus,
} from "@/lib/db/store.mjs"
import type { MarketDoc } from "@/lib/db/types"
import type { ClimateMarket, MarketListQuery, MarketListResult, MarketHistoryPoint, MarketHistoryResult } from "@/lib/markets/types"

function marketDocToClimateMarket(doc: MarketDoc): ClimateMarket {
  return {
    id: doc.marketId,
    onchainMarketId: doc.onchainMarketId,
    question: doc.question,
    slug: doc.slug,
    description: doc.description,
    category: doc.category as ClimateMarket["category"],
    continent: doc.continent as ClimateMarket["continent"],
    country: doc.country,
    region: doc.region,
    latitude: doc.latitude,
    longitude: doc.longitude,
    closeTime: doc.closesAt.toISOString(),
    resolutionTime: doc.resolvesAt.toISOString(),
    status: doc.status,
    outcome: doc.outcome,
    yesPrice: doc.yesPrice,
    noPrice: doc.noPrice,
    yesLiquidity: doc.yesLiquidity,
    noLiquidity: doc.noLiquidity,
    totalVolume: doc.totalVolume,
    participants: doc.participants,
    resolutionSource: doc.resolutionSource,
    resolutionSourceUrl: doc.resolutionSourceUrl,
    resolutionRules: doc.resolutionRules,
    resolver: doc.resolver,
    createdAt: doc.createdAt.toISOString(),
    featured: doc.featured,
    trendingScore: doc.trendingScore,
    history: Array.isArray(doc.history) ? doc.history : [],
    evidence: Array.isArray(doc.evidence) ? doc.evidence : [],
    recentTrades: Array.isArray(doc.recentTrades) ? doc.recentTrades : [],
    network: "devnet",
    settlementAsset: "SOL",
    marketModel: "pooled-binary",
  }
}

export async function queryMarkets(query: MarketListQuery): Promise<MarketListResult> {
  const result = storeListMarkets(query) as unknown as {
    markets: MarketDoc[]
    total: number
    limit: number
    offset: number
  }
  return {
    markets: result.markets.map(marketDocToClimateMarket),
    total: result.total,
    limit: result.limit,
    offset: result.offset,
  }
}

export async function getMarketById(
  idOrSlug: string,
): Promise<ClimateMarket | null> {
  const doc = getMarketByIdOrSlug(idOrSlug) as unknown as MarketDoc | null
  return doc ? marketDocToClimateMarket(doc) : null
}

export async function getMarketsByContinent(
  continent: string,
  query: Partial<MarketListQuery> = {},
): Promise<MarketListResult> {
  const result = storeListByContinent(continent, query) as unknown as {
    markets: MarketDoc[]
    total: number
    limit: number
    offset: number
  }
  return {
    markets: result.markets.map(marketDocToClimateMarket),
    total: result.total,
    limit: result.limit,
    offset: result.offset,
  }
}

export async function getMarketHistory(
  marketId: string,
): Promise<MarketHistoryResult | null> {
  const market = await getMarketById(marketId)
  if (!market) return null

  // Merge embedded tape backfill with live snapshots, oldest first.
  // Embedded points win exact-timestamp ties; either source alone still
  // yields a usable series.
  const byTime = new Map<string, MarketHistoryPoint>()
  for (const point of market.history) {
    byTime.set(point.timestamp, point)
  }
  try {
    const rowId = getRowIdByMarketId(market.id)
    if (rowId !== null) {
      for (const snap of listPriceSnapshots(rowId)) {
        const s = snap as unknown as {
          timestamp: string
          yesPrice: number
          noPrice: number
          volume: number
          yesLiquidity: number | null
          noLiquidity: number | null
          totalVolume: number | null
        }
        if (byTime.has(s.timestamp)) continue
        byTime.set(s.timestamp, {
          timestamp: s.timestamp,
          yesProbability: s.yesPrice,
          noProbability: s.noPrice,
          totalVolume: s.totalVolume ?? s.volume ?? 0,
          yesLiquidity: s.yesLiquidity ?? 0,
          noLiquidity: s.noLiquidity ?? 0,
        })
      }
    }
  } catch {
    // Snapshots are best-effort; embedded history still renders.
  }

  const history = [...byTime.values()].sort(
    (a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp),
  )

  return {
    marketId: market.id,
    question: market.question,
    history,
  }
}

export async function getMarketDocIdByMarketId(
  marketId: string,
): Promise<number | null> {
  return getRowIdByMarketId(marketId)
}

export async function setMarketStatus(
  marketDocId: string,
  status: MarketDoc["status"],
  outcome?: MarketDoc["outcome"],
): Promise<void> {
  updateMarketStatus(marketDocId, status, outcome)
}

export async function incrementMarketActivity(params: {
  marketDocId: string
  amountSol: number
  walletAddress: string
}): Promise<void> {
  storeIncrementActivity(params.marketDocId, params.amountSol, params.walletAddress)
}

export async function appendMarketHistoryPoint(
  marketDocId: string,
  point: MarketHistoryPoint,
): Promise<void> {
  storeAppendHistoryPoint(marketDocId, point)
}
