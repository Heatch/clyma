import { openStore } from "./store.mjs"

let initialized = false

export async function initDb(): Promise<void> {
  if (initialized) return
  openStore()
  initialized = true
}
