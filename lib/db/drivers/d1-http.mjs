// lib/db/drivers/d1-http.mjs — D1 REST driver for CLI scripts.
//
// Scripts run on a normal Node.js machine (predictable filesystem, funded
// devnet wallet) but must write the live database. This driver speaks
// Cloudflare's D1 HTTP API so `lifecycle.mjs` and friends hit production
// without a VPS:
//
//   CLOUDFLARE_ACCOUNT_ID=... CLOUDFLARE_D1_DATABASE_ID=... \
//   CLOUDFLARE_API_TOKEN=... node scripts/lifecycle.mjs roll
//
// Without those variables scripts fall back to the local node:sqlite file.

import { DDL } from "../schema.mjs"

const API_BASE = "https://api.cloudflare.com/client/v4"

function isBlank(row) {
  if (row === undefined || row === null) return true
  if (typeof row !== "object") return false
  return Object.values(row).every((value) => value == null)
}

export async function createD1HttpDriver({
  accountId,
  databaseId,
  apiToken,
  baseUrl = API_BASE,
  fetchImpl = fetch,
}) {
  if (!accountId || !databaseId || !apiToken) {
    throw new Error(
      "createD1HttpDriver: accountId, databaseId and apiToken are required",
    )
  }
  const endpoint = `${baseUrl}/accounts/${accountId}/d1/database/${databaseId}/query`

  async function query(sql, params = []) {
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ sql, params }),
    })
    const payload = await response.json().catch(() => null)
    if (!response.ok || !payload?.success) {
      const message =
        payload?.errors?.map((error) => error.message).join("; ") ??
        `D1 HTTP ${response.status}`
      throw new Error(`D1 query failed: ${message}`)
    }
    return payload.result?.[0] ?? { results: [], success: true, meta: {} }
  }

  const existing = await query(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='markets'",
  )
  if (!existing.results?.length) {
    await query(DDL)
  }

  return {
    kind: "d1-http",
    async exec(sql) {
      await query(sql)
    },
    async run(sql, params = []) {
      const result = await query(sql, params)
      return {
        changes: Number(result.meta?.changes ?? 0),
        lastInsertRowid: result.meta?.last_row_id ?? null,
      }
    },
    async all(sql, params = []) {
      const result = await query(sql, params)
      return result.results ?? []
    },
    async get(sql, params = []) {
      const result = await query(sql, params)
      const row = result.results?.[0]
      return isBlank(row) ? undefined : row
    },
    async batch(statements) {
      // The HTTP API accepts one statement per call; run sequentially so
      // ordering (and therefore idempotency) matches the binding driver.
      const results = []
      for (const statement of statements) {
        const result = await query(statement.sql, statement.params ?? [])
        results.push({ rows: result.results ?? [] })
      }
      return results
    },
    async close() {},
  }
}
