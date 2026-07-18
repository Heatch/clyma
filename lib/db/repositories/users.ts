import { getUsersCollection } from "@/lib/db/collections"
import type { UserDoc } from "@/lib/db/types"

export async function upsertUser(walletAddress: string): Promise<UserDoc> {
  const users = await getUsersCollection()
  const now = new Date()
  const result = await users.findOneAndUpdate(
    { walletAddress },
    {
      $setOnInsert: { walletAddress, createdAt: now },
      $set: { lastLoginAt: now },
    },
    { upsert: true, returnDocument: "after" },
  )
  return result as unknown as UserDoc
}

export async function getUserByWallet(walletAddress: string): Promise<UserDoc | null> {
  const users = await getUsersCollection()
  return (await users.findOne({ walletAddress })) as UserDoc | null
}
