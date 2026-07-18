import { getResolutionsCollection } from "@/lib/db/collections"
import type { ResolutionDoc } from "@/lib/db/types"
import { getMarketDocIdByMarketId } from "./markets"

export async function insertResolution(params: {
  marketDocId: string
  resolvedOutcome: ResolutionDoc["resolvedOutcome"]
  resolverType: ResolutionDoc["resolverType"]
  resolverWallet: string
  proofUrl?: string
}): Promise<ResolutionDoc> {
  const resolutions = await getResolutionsCollection()
  const marketId = await getMarketDocIdByMarketId(params.marketDocId)

  const doc = {
    marketId,
    marketDocId: params.marketDocId,
    dataSource: "solana-program",
    resolvedOutcome: params.resolvedOutcome,
    resolverType: params.resolverType,
    resolverWallet: params.resolverWallet,
    proofUrl: params.proofUrl,
    resolvedAt: new Date(),
  }

  await resolutions.insertOne(doc)
  return doc as ResolutionDoc
}
