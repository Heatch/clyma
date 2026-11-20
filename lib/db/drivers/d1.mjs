// lib/db/drivers/d1.mjs — Cloudflare D1 binding driver (Workers runtime).
//
// Mirrors the driver surface in ./node-sqlite.mjs. Kept dependency-free so
// the Workers bundle only carries D1 calls.

import { DDL } from "../schema.mjs"

function isBlank(row) {
  if (row === undefined || row === null) return true
  if (typeof row !== "object") return false
  return Object.values(row).every((value) => value == null)
}

export async function createD1Driver(binding) {
  const prepare = (sql, params = []) =>
    params.length > 0
      ? binding.prepare(sql).bind(...params)
      : binding.prepare(sql)

  // D1 has no PRAGMA user_version we can rely on, so migrations are gated
  // on the presence of the core table instead. Idempotent DDL either way.
  // Normalize through isBlank: node:sqlite (used by the test fake) returns a
  // null-filled object where D1 returns null for a no-match first().
  const existing = await binding
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='markets'",
    )
    .first()
  if (isBlank(existing)) {
    await binding.exec(DDL)
  }

  return {
    kind: "d1",
    async exec(sql) {
      await binding.exec(sql)
    },
    async run(sql, params = []) {
      const result = await prepare(sql, params).run()
      return {
        changes: Number(result.meta?.changes ?? 0),
        lastInsertRowid: result.meta?.last_row_id ?? null,
      }
    },
    async all(sql, params = []) {
      const result = await prepare(sql, params).all()
      return result.results ?? []
    },
    async get(sql, params = []) {
      const row = await prepare(sql, params).first()
      return isBlank(row) ? undefined : row
    },
    async batch(statements) {
      if (statements.length === 0) return []
      const prepared = statements.map((statement) =>
        prepare(statement.sql, statement.params ?? []),
      )
      const results = await binding.batch(prepared)
      return results.map((result) => ({ rows: result.results ?? [] }))
    },
    async close() {
      // The binding is owned by the Worker environment; nothing to close.
    },
  }
}
