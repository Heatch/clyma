import { DatabaseSync } from "node:sqlite"
import { beforeEach, describe, expect, it } from "vitest"

import { createD1HttpDriver } from "@/lib/db/drivers/d1-http.mjs"
import type { D1Fetch } from "@/lib/db/drivers/d1-http.mjs"

/**
 * Exercises the D1 REST driver that `scripts/*.mjs` use against production.
 * A fake fetch maps Cloudflare's `/query` contract onto real in-memory
 * SQLite, so request shaping, result unwrapping, meta mapping and the error
 * path are all covered without network access.
 */
function createHttpHarness() {
  const sqlite = new DatabaseSync(":memory:")
  const calls: Array<{ sql: string; params: unknown[] }> = []

  const fetchImpl: D1Fetch = async (_url, init) => {
    const body = JSON.parse(String(init.body)) as {
      sql: string
      params?: unknown[]
    }
    calls.push({ sql: body.sql, params: body.params ?? [] })
    const params = (body.params ?? []) as never[]

    try {
      const trimmed = body.sql.trim().toUpperCase()
      const isRead =
        trimmed.startsWith("SELECT") || trimmed.startsWith("PRAGMA")
      if (isRead) {
        const results = sqlite.prepare(body.sql).all(...params)
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            result: [{ results, success: true, meta: { changes: 0 } }],
          }),
        }
      }
      const info = sqlite.prepare(body.sql).run(...params)
      return {
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          result: [
            {
              results: [],
              success: true,
              meta: {
                changes: Number(info.changes),
                last_row_id: info.lastInsertRowid,
              },
            },
          ],
        }),
      }
    } catch (error) {
      return {
        ok: false,
        status: 400,
        json: async () => ({
          success: false,
          errors: [{ message: (error as Error).message }],
        }),
      }
    }
  }

  return { sqlite, calls, fetchImpl }
}

const config = {
  accountId: "acct",
  databaseId: "db",
  apiToken: "token",
}

describe("D1 HTTP driver", () => {
  let harness: ReturnType<typeof createHttpHarness>

  beforeEach(() => {
    harness = createHttpHarness()
  })

  it("creates the schema on first use and maps meta fields", async () => {
    const driver = await createD1HttpDriver({
      ...config,
      fetchImpl: harness.fetchImpl,
    })

    const inserted = await driver.run(
      "INSERT INTO users (wallet_address, created_at, last_login_at) VALUES (?, ?, ?)",
      ["wallet-1", "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z"],
    )
    expect(inserted.changes).toBe(1)
    expect(Number(inserted.lastInsertRowid)).toBeGreaterThan(0)

    const row = await driver.get(
      "SELECT * FROM users WHERE wallet_address = ?",
      ["wallet-1"],
    )
    expect(row?.wallet_address).toBe("wallet-1")
    expect(
      await driver.get("SELECT * FROM users WHERE wallet_address = ?", [
        "nope",
      ]),
    ).toBeUndefined()
  })

  it("sends the documented request shape to the D1 endpoint", async () => {
    const driver = await createD1HttpDriver({
      ...config,
      fetchImpl: harness.fetchImpl,
    })
    await driver.all("SELECT 1 AS one")

    const last = harness.calls.at(-1)!
    expect(last.sql).toBe("SELECT 1 AS one")
    expect(last.params).toEqual([])
  })

  it("runs batches sequentially and returns rows per statement", async () => {
    const driver = await createD1HttpDriver({
      ...config,
      fetchImpl: harness.fetchImpl,
    })
    const results = await driver.batch([
      { sql: "SELECT 1 AS a" },
      { sql: "SELECT 2 AS b" },
    ])
    expect(results.map((entry) => entry.rows[0])).toEqual([{ a: 1 }, { b: 2 }])
  })

  it("surfaces Cloudflare error messages", async () => {
    const driver = await createD1HttpDriver({
      ...config,
      fetchImpl: harness.fetchImpl,
    })
    await expect(driver.all("SELECT * FROM missing_table")).rejects.toThrow(
      /no such table: missing_table/,
    )
  })
})
