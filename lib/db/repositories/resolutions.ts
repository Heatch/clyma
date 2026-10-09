import { insertResolution as storeInsertResolution } from "@/lib/db/store.mjs"
import type { ResolutionDoc } from "@/lib/db/types"

export async function insertResolution(params: {
  marketDocId: string
  resolvedOutcome: ResolutionDoc["resolvedOutcome"]
  resolverType: ResolutionDoc["resolverType"]
  resolverWallet: string
  proofUrl?: string
}): Promise<ResolutionDoc> {
  return storeInsertResolution(params) as unknown as ResolutionDoc
}
