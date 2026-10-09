// Shared script config: the deployed program address lives in exactly one
// place — NEXT_PUBLIC_PROGRAM_ID in .env (documented in .env.example).
// All scripts read it through here so the app and the seeders can never
// disagree about which program they target.

import { PublicKey } from "@solana/web3.js"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..")

export const DEPLOYED_PROGRAM_ID =
  "EkcwkAzNUCGRcKCA5WJc7GCtUXooubkm3ktesBWQXPBt"
export const DEFAULT_RPC_URL = "https://api.devnet.solana.com"

export function loadEnv() {
  const envPath = join(ROOT, ".env")
  try {
    const content = readFileSync(envPath, "utf-8")
    for (const line of content.split("\n")) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith("#")) continue
      const eq = trimmed.indexOf("=")
      if (eq === -1) continue
      const key = trimmed.slice(0, eq).trim()
      if (key && !process.env[key]) {
        process.env[key] = trimmed.slice(eq + 1).trim()
      }
    }
  } catch {
    // .env not found, proceed with existing env vars
  }
}

export function requireProgramId() {
  const raw = process.env.NEXT_PUBLIC_PROGRAM_ID?.trim()
  if (!raw) {
    console.error(
      "NEXT_PUBLIC_PROGRAM_ID is not set. Expected the deployed Devnet program id " +
        `(${DEPLOYED_PROGRAM_ID}) in .env — see .env.example.`,
    )
    process.exit(1)
  }
  try {
    return new PublicKey(raw)
  } catch {
    console.error(
      `NEXT_PUBLIC_PROGRAM_ID is not a valid Solana public key: ${raw}`,
    )
    process.exit(1)
  }
}

export function resolveRpcUrl() {
  return process.env.NEXT_PUBLIC_SOLANA_RPC_URL?.trim() || DEFAULT_RPC_URL
}
