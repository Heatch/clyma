import { getMarketPricesCollection, getMarketsCollection } from "@/lib/db/collections"
import type { MarketDoc, MarketPriceDoc } from "@/lib/db/types"
import type { ClimateMarket, MarketListQuery, MarketListResult, MarketHistoryPoint, MarketHistoryResult } from "@/lib/markets/types"
import { calculateImpliedProbabilities } from "@/lib/markets/calculations"
import type { ObjectId } from "mongodb"

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
  const markets = await getMarketsCollection()
  const filter: Record<string, unknown> = {}

  if (query.search) {
    filter.title = { $regex: query.search, $options: "i" }
  }
  if (query.category) filter.category = query.category
  if (query.continent) filter.continent = query.continent
  if (query.status) filter.status = query.status
  if (query.featured !== undefined) filter.featured = query.featured

  const limit = query.limit ?? 24
  const offset = query.offset ?? 0
  const total = await markets.countDocuments(filter)
  const docs = await markets
    .find(filter)
    .sort({ trendingScore: -1 })
    .skip(offset)
    .limit(limit)
    .toArray()

  return {
    markets: docs.map((d) =>
      marketDocToClimateMarket(d as unknown as MarketDoc),
    ),
    total,
    limit,
    offset,
  }
}

export async function getMarketById(
  idOrSlug: string,
): Promise<ClimateMarket | null> {
  const markets = await getMarketsCollection()
  const doc = (await markets.findOne({
    $or: [{ marketId: idOrSlug }, { slug: idOrSlug }],
  })) as MarketDoc | null
  return doc ? marketDocToClimateMarket(doc) : null
}

export async function getMarketsByContinent(
  continent: string,
  query: Partial<MarketListQuery> = {},
): Promise<MarketListResult> {
  const markets = await getMarketsCollection()
  const filter: Record<string, unknown> = { continent }

  if (query.search) filter.title = { $regex: query.search, $options: "i" }
  if (query.category) filter.category = query.category
  if (query.status) filter.status = query.status

  const limit = query.limit ?? 24
  const offset = query.offset ?? 0
  const total = await markets.countDocuments(filter)
  const docs = await markets.find(filter).skip(offset).limit(limit).toArray()

  return {
    markets: docs.map((d) =>
      marketDocToClimateMarket(d as unknown as MarketDoc),
    ),
    total,
    limit,
    offset,
  }
}

export async function updateMarketPrices(
  marketDocId: string,
  yesAmount: number,
  noAmount: number,
  totalPool: number,
): Promise<void> {
  const markets = await getMarketsCollection()
  const probabilities = calculateImpliedProbabilities(
    BigInt(Math.round(yesAmount * 1e9)),
    BigInt(Math.round(noAmount * 1e9)),
  )

  await markets.updateOne(
    { marketId: marketDocId },
    {
      $set: {
        yesPrice: probabilities.yes,
        noPrice: probabilities.no,
        yesLiquidity: yesAmount,
        noLiquidity: noAmount,
      },
      $inc: { totalVolume: yesAmount + noAmount },
    },
  )
}

export async function getMarketHistory(
  marketId: string,
): Promise<MarketHistoryResult | null> {
  const market = await getMarketById(marketId)
  if (!market) return null

  // Merge tape backfill (embedded) with live snapshots, oldest first.
  // Embedded points win exact-timestamp ties; either source alone still
  // yields a usable series.
  const byTime = new Map<string, MarketHistoryPoint>()
  for (const point of market.history) {
    byTime.set(point.timestamp, point)
  }
  try {
    const prices = await getMarketPricesCollection()
    const docId = await getMarketDocIdByMarketId(market.id)
    if (docId) {
      const snaps = await prices
        .find({ marketId: docId })
        .sort({ timestamp: 1 })
        .toArray()
      for (const snap of snaps as unknown as MarketPriceDoc[]) {
        const timestamp = snap.timestamp.toISOString()
        if (byTime.has(timestamp)) continue
        byTime.set(timestamp, {
          timestamp,
          yesProbability: snap.yesPrice,
          noProbability: snap.noPrice,
          totalVolume: snap.totalVolume ?? snap.volume ?? 0,
          yesLiquidity: snap.yesLiquidity ?? 0,
          noLiquidity: snap.noLiquidity ?? 0,
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
): Promise<ObjectId | null> {
  const markets = await getMarketsCollection()
  const doc = await markets.findOne({ marketId }, { projection: { _id: 1 } })
  return doc ? (doc as { _id: ObjectId })._id : null
}

/**
 * Records a confirmed purchase against the market document: turnover and
 * unique-participant counters. Repeat buys from the same wallet bump volume
 * but not the participant count.
 */
export async function incrementMarketActivity(params: {
  marketDocId: string
  amountSol: number
  walletAddress: string
}): Promise<void> {
  const markets = await getMarketsCollection()
  await markets.updateOne(
    { marketId: params.marketDocId },
    {
      $inc: { totalVolume: params.amountSol },
      $addToSet: { participantWallets: params.walletAddress },
    },
  )
  const doc = await markets.findOne(
    { marketId: params.marketDocId },
    { projection: { participantWallets: 1 } },
  )
  const wallets = (doc as { participantWallets?: unknown } | null)
    ?.participantWallets
  if (Array.isArray(wallets)) {
    await markets.updateOne(
      { marketId: params.marketDocId },
      { $set: { participants: wallets.length } },
    )
  }
}

/**
 * Appends a live trade point to the market document's embedded history (the
 * chart source), keeping the most recent 500 points. Tape backfill provides
 * the older points; this keeps the line bending after real trades without a
 * separate read path.
 */
export async function appendMarketHistoryPoint(
  marketDocId: string,
  point: MarketHistoryPoint,
): Promise<void> {
  const markets = await getMarketsCollection()
  // $each/$slice capped push; the untyped driver signature needs a cast.
  const push = {
    $push: { history: { $each: [point], $slice: -500 } },
  } as never
  await markets.updateOne({ marketId: marketDocId }, push)
}
