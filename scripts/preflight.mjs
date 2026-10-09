// scripts/preflight.mjs — chain readiness check before any seeding.
//
// Verifies, in order:
//   1. RPC is reachable
//   2. A program account exists at NEXT_PUBLIC_PROGRAM_ID, is executable,
//      and is owned by the BPF upgradeable loader
//   3. The protocol PDA decodes as our ProtocolConfig account (discriminator
//      match) — this validates the deployed program uses this repo's account
//      layout ("matches IDL"). A missing protocol PDA is NOT a failure:
//      `node scripts/lifecycle.mjs seed` initializes it.
//   4. A local wallet exists and its balance is reported.
//
// Usage: node scripts/preflight.mjs
// Exit 0 when the program checks pass, 1 on any hard failure.

import { Connection, PublicKey } from "@solana/web3.js"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js"

import { loadEnv, requireProgramId, resolveRpcUrl } from "./lib/env.mjs"

loadEnv()

const BPF_UPGRADEABLE_LOADER = new PublicKey(
  "BPFLoaderUpgradeab1e11111111111111111111111",
)
const PROTOCOL_SEED = Buffer.from("protocol")
const PROTOCOL_DISCRIMINATOR = createHash("sha256")
  .update("account:ProtocolConfig")
  .digest()
  .subarray(0, 8)

let failed = false

function ok(label, detail = "") {
  console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ""}`)
}

function fail(label, detail = "") {
  failed = true
  console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`)
}

async function main() {
  const programId = requireProgramId()
  const rpc = resolveRpcUrl()
  console.log(`RPC: ${rpc}`)
  console.log(`Program: ${programId.toBase58()}`)

  const connection = new Connection(rpc, "confirmed")

  // 1. RPC reachable
  try {
    const version = await connection.getVersion()
    ok("RPC reachable", `solana-core ${version["solana-core"]}`)
  } catch (err) {
    fail("RPC reachable", String(err))
    process.exit(1)
  }

  // 2. Program account
  const programInfo = await connection.getAccountInfo(programId)
  if (!programInfo) {
    fail(
      "Program account exists",
      "no account at NEXT_PUBLIC_PROGRAM_ID — is the program deployed to this cluster?",
    )
  } else if (!programInfo.executable) {
    fail("Program account is executable", "account exists but is not executable")
  } else if (!programInfo.owner.equals(BPF_UPGRADEABLE_LOADER)) {
    fail(
      "Program owned by BPF upgradeable loader",
      `owner is ${programInfo.owner.toBase58()}`,
    )
  } else {
    ok(
      "Program deployed",
      `executable, ${programInfo.data.length} bytes, owner BPF loader`,
    )
  }

  // 3. Protocol PDA
  const [protocolAddress] = PublicKey.findProgramAddressSync(
    [PROTOCOL_SEED],
    programId,
  )
  const protocolInfo = await connection.getAccountInfo(protocolAddress)
  if (!protocolInfo) {
    console.log(
      `  WARN  Protocol not initialized at ${protocolAddress.toBase58()} — run \`node scripts/lifecycle.mjs seed\` to initialize it`,
    )
  } else if (protocolInfo.data.length < 81) {
    fail(
      "Protocol account layout",
      `expected >= 81 bytes, got ${protocolInfo.data.length}`,
    )
  } else if (
    !protocolInfo.data.subarray(0, 8).equals(PROTOCOL_DISCRIMINATOR)
  ) {
    fail(
      "Protocol discriminator",
      "PDA data does not match this repo's ProtocolConfig layout — the deployed program is not this program",
    )
  } else {
    const marketCount = protocolInfo.data.readBigUInt64LE(72)
    const authority = new PublicKey(protocolInfo.data.subarray(8, 40))
    const resolver = new PublicKey(protocolInfo.data.subarray(40, 72))
    ok(
      "Protocol initialized",
      `market_count=${marketCount} authority=${authority.toBase58()} resolver=${resolver.toBase58()}`,
    )
  }

  // 4. Wallet
  const walletPath = join(homedir(), ".config", "solana", "id.json")
  try {
    const secret = JSON.parse(readFileSync(walletPath, "utf-8"))
    const wallet = Keypair.fromSecretKey(Uint8Array.from(secret))
    const balance = await connection.getBalance(wallet.publicKey)
    const sol = balance / LAMPORTS_PER_SOL
    console.log(
      `  INFO  Wallet ${wallet.publicKey.toBase58()} balance: ${sol} SOL`,
    )
    if (sol < 10) {
      console.log(
        "  WARN  Seeding 100 markets is budgeted at ~10 SOL total (pools + rent + trading float + fees). Fund the wallet before running setup.",
      )
    } else {
      ok("Wallet funded", `${sol} SOL available`)
    }
  } catch {
    console.log(
      `  WARN  No Solana keypair at ${walletPath} — seeding requires one`,
    )
  }

  if (failed) {
    console.log("\nPreflight FAILED — fix the items above before seeding.")
    process.exit(1)
  }
  console.log("\nPreflight OK")
}

main().catch((err) => {
  console.error("Preflight error:", err.message)
  process.exit(1)
})
