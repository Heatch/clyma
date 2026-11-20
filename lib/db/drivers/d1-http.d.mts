// Types for ./d1-http.mjs (D1 REST driver used by CLI scripts).

import type { StoreDriver } from "../store.mjs"

/** Minimal fetch contract: what the driver needs, no DOM Response types. */
export type D1Fetch = (
  input: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>

export interface D1HttpConfig {
  accountId: string
  databaseId: string
  apiToken: string
  baseUrl?: string
  fetchImpl?: D1Fetch
}

export function createD1HttpDriver(config: D1HttpConfig): Promise<StoreDriver>
