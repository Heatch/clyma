import { ensureIndexes } from "./collections"

let initialized = false

export async function initDb(): Promise<void> {
  if (initialized) return
  await ensureIndexes()
  initialized = true
}
