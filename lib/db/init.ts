import { ensureIndexes } from "./collections"
import { syncDemoMarkets } from "./repositories/markets"

let initialized = false

export async function initDb(): Promise<void> {
  if (initialized) return
  await ensureIndexes()
  await syncDemoMarkets()
  initialized = true
}
