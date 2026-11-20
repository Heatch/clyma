// lib/db/drivers/node-sqlite.mjs — local/CLI driver backed by node:sqlite.
//
// This module may only be loaded where a real Node.js runtime exists:
// `node scripts/*`, `next dev`, `next start`, and the vitest suite. The
// Workers bundle never evaluates it (store.mjs imports it dynamically and
// only when no D1 binding is present).

import { DatabaseSync } from "node:sqlite"
import { mkdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { DDL, SCHEMA_VERSION } from "../schema.mjs"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..")

export function defaultSqlitePath() {
  return join(ROOT, "data", "clyma.db")
}

function migrate(db) {
  const row = db.prepare("PRAGMA user_version").get()
  if ((row?.user_version ?? 0) >= SCHEMA_VERSION) return
  db.exec(DDL)
  db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`)
}

/**
 * Opens a SQLite file (or `:memory:`) and returns the async driver surface
 * the store consumes. node:sqlite is synchronous, so each method simply
 * wraps the call — callers always `await`, which works for both drivers.
 */
export async function createNodeDriver(target) {
  if (target !== ":memory:") mkdirSync(dirname(target), { recursive: true })
  const db = new DatabaseSync(target)
  if (target !== ":memory:") {
    db.exec(
      "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;",
    )
  } else {
    db.exec("PRAGMA foreign_keys=ON;")
  }
  migrate(db)

  return {
    kind: "node-sqlite",
    target,
    async exec(sql) {
      db.exec(sql)
    },
    async run(sql, params = []) {
      const info = db.prepare(sql).run(...params)
      return {
        changes: Number(info.changes),
        lastInsertRowid: info.lastInsertRowid,
      }
    },
    async all(sql, params = []) {
      return db.prepare(sql).all(...params)
    },
    async get(sql, params = []) {
      return db.prepare(sql).get(...params)
    },
    async batch(statements) {
      const results = []
      for (const statement of statements) {
        results.push({
          rows: db.prepare(statement.sql).all(...(statement.params ?? [])),
        })
      }
      return results
    },
    async close() {
      db.close()
    },
  }
}
