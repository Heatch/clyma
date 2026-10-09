import { getMarketPricesCollection } from "@/lib/db/collections"
import type { MarketPriceDoc } from "@/lib/db/types"
import { getMarketDocIdByMarketId } from "./markets"
import type { ObjectId } from "mongodb"

export async function insertPriceSnapshot(params: {
  marketDocId: string
  yesPrice: number
  noPrice: number
  volume: number
  triggerEvent: MarketPriceDoc["triggerEvent"]
  yesLiquidity?: number
  noLiquidity?: number
  totalVolume?: number
}): Promise<void> {
  const prices = await getMarketPricesCollection()
  const marketId = await getMarketDocIdByMarketId(params.marketDocId)

  await prices.insertOne({
    marketId,
    timestamp: new Date(),
    yesPrice: params.yesPrice,
    noPrice: params.noPrice,
    volume: params.volume,
    triggerEvent: params.triggerEvent,
    yesLiquidity: params.yesLiquidity,
    noLiquidity: params.noLiquidity,
    totalVolume: params.totalVolume,
  } as Omit<MarketPriceDoc, "_id">)
}
