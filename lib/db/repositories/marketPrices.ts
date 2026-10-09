import {
  deleteCreationSnapshots,
  getRowIdByMarketId,
  insertPriceSnapshot as storeInsertSnapshot,
  listPriceSnapshots,
} from "@/lib/db/store.mjs"
import type { MarketPriceDoc } from "@/lib/db/types"

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
  const marketRowId = getRowIdByMarketId(params.marketDocId)
  storeInsertSnapshot({ ...params, marketRowId })
}

export async function getPriceSnapshots(
  marketDocId: string,
): Promise<MarketPriceDoc[]> {
  const marketRowId = getRowIdByMarketId(marketDocId)
  if (marketRowId === null) return []
  return listPriceSnapshots(marketRowId) as unknown as MarketPriceDoc[]
}

export async function clearCreationSnapshots(
  marketDocId: string,
): Promise<void> {
  const marketRowId = getRowIdByMarketId(marketDocId)
  if (marketRowId !== null) deleteCreationSnapshots(marketRowId)
}
