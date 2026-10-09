import {
  getUserByWallet as storeGetUser,
  upsertUser as storeUpsertUser,
} from "@/lib/db/store.mjs"
import type { UserDoc } from "@/lib/db/types"

export async function upsertUser(walletAddress: string): Promise<UserDoc> {
  return storeUpsertUser(walletAddress) as unknown as UserDoc
}

export async function getUserByWallet(
  walletAddress: string,
): Promise<UserDoc | null> {
  return (storeGetUser(walletAddress) as unknown as UserDoc | null) ?? null
}
