import { openD1Store, openStore } from "./store.mjs"

let initialized: Promise<void> | null = null

/**
 * Returns the Cloudflare bindings when running inside a Worker, or
 * undefined under plain Node (next dev / next start / vitest). The dynamic
 * import keeps the adapter package out of the local Node path.
 */
async function cloudflareBindings(): Promise<
  Record<string, unknown> | undefined
> {
  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare")
    const context = getCloudflareContext() as unknown as
      { env?: Record<string, unknown> } | undefined
    return context?.env
  } catch {
    return undefined
  }
}

async function open(): Promise<void> {
  const bindings = await cloudflareBindings()
  const d1 = bindings?.DB as Parameters<typeof openD1Store>[0] | undefined
  if (d1) {
    await openD1Store(d1)
    return
  }
  await openStore()
}

/**
 * Opens the data layer once per runtime instance: the D1 binding on
 * Workers, the local SQLite file everywhere else. Safe to call from every
 * request — the promise is shared, and a failed open retries next call.
 */
export function initDb(): Promise<void> {
  if (!initialized) {
    initialized = open().catch((error) => {
      initialized = null
      throw error
    })
  }
  return initialized
}
