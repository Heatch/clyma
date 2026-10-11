// scripts/lifecycle.mjs — market lifecycle operations:
// seed | close | resolve | roll | boost.
//
//   node scripts/lifecycle.mjs seed [--markets 100] [--budget 6.5]
//     [--base-id 3001] [--fixture-file PATH] [--reset]
//     [--skip-chain] [--skip-db] [--dry-run] [--force]
//
// Pipeline (generate everything first, write nothing until validated):
//   1. definitions — batched model generation (<=40 per call), or raw
//      definitions loaded from --fixture-file (same {"markets": [...]} shape).
//      Validated, de-duplicated; the validated set is always saved to
//      os.tmpdir()/clyma/seed-definitions-<ts>.json so a run can be replayed
//      offline later via --fixture-file.
//   2. tapes — deterministic trade tape per market (scripts/lib/tape.mjs).
//      Target odds = the definition's estimatedProbability; depth averages
//      budget/markets. Tape pool totals are the EXACT lamport amounts funded
//      on-chain, so charts open at model odds and end at the chain price.
//   3. budget — funding + rent (queried live) + fee buffer vs wallet balance.
//      Aborts before any write unless sufficient or --force. --dry-run prints
//      the plan and exits here.
//   4. chain — init protocol if missing; create_market + asymmetric
//      fund_market(yesLamports, noLamports) per new market; skips existing PDAs.
//   5. index — upsert Mongo market docs (history/recentTrades from the tape),
//      replace that market's "creation" price snapshots, recreate indexes
//      after --reset (which drops markets/positions/transactions/
//      market_prices/resolutions but keeps users/auth_challenges).

import { complete } from "../lib/llm/backboard.mjs"
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js"
import { createHash } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { readFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { loadEnv, requireProgramId, resolveRpcUrl } from "./lib/env.mjs"
import { buildTape, LAMPORTS_PER_SOL } from "./lib/tape.mjs"
import {
  appendHistoryPoint,
  appendRecentTrades,
  countOpenMarkets,
  dueToClose,
  dueToResolve,
  insertPriceSnapshot,
  insertResolution,
  insertTransaction,
  listOpenMarketPools,
  maxOnchainMarketId,
  replaceCreationSnapshots,
  replaceHistory,
  resetMarketData,
  seedParticipants,
  settlePositionsByMarket,
  updateMarketPools,
  updateMarketStatus,
  upsertMarket,
} from "../lib/db/store.mjs"

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = {
    command: argv[0],
    markets: 100,
    budget: 6.5,
    budgetExplicit: false,
    baseId: 3001,
    batchSize: 25,
    fixtureFile: null,
    reset: false,
    skipChain: false,
    skipDb: false,
    dryRun: false,
    force: false,
    targetTotal: 15,
    minDepth: 0.02,
    maxDepth: 1.5,
    boostSeed: "boost",
  }
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i]
    if (a === "--reset") args.reset = true
    else if (a === "--skip-chain") args.skipChain = true
    else if (a === "--skip-db") args.skipDb = true
    else if (a === "--dry-run") args.dryRun = true
    else if (a === "--force") args.force = true
    else if (a === "--markets") args.markets = Number(argv[++i])
    else if (a === "--batch-size") args.batchSize = Number(argv[++i])
    else if (a === "--budget") {
      args.budget = Number(argv[++i])
      args.budgetExplicit = true
    } else if (a === "--base-id") args.baseId = Number(argv[++i])
    else if (a === "--fixture-file") args.fixtureFile = argv[++i]
    else if (a === "--target-total") args.targetTotal = Number(argv[++i])
    else if (a === "--min-depth") args.minDepth = Number(argv[++i])
    else if (a === "--max-depth") args.maxDepth = Number(argv[++i])
    else if (a === "--seed-tag") args.boostSeed = argv[++i]
    else {
      console.error(`Unknown flag: ${a}`)
      process.exit(1)
    }
  }
  return args
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PROTOCOL_SEED = Buffer.from("protocol")
const MARKET_SEED = Buffer.from("market")
const VAULT_SEED = Buffer.from("vault")
const YES_POSITION_SEED = Buffer.from("yes_position")
const NO_POSITION_SEED = Buffer.from("no_position")

const MARKET_SPACE = 204 // programs/climate_market/src/state.rs Market::SPACE
const VAULT_SPACE = 41 // MarketVault::SPACE
const PROTOCOL_SPACE = 81 // ProtocolConfig::SPACE
const FEE_BUFFER_LAMPORTS = 50_000_000 // 0.05 SOL for fees + slack

const DAY_MS = 86_400_000
const GENERATION_TIMEOUT_MS = 600_000
const GENERATION_BATCH_MAX = 40

const MARKET_CATEGORIES = [
  "hurricane",
  "drought",
  "temperature",
  "rainfall",
  "crop-yield",
  "wildfire",
  "flooding",
  "other",
]
const MARKET_CONTINENTS = [
  "North America",
  "South America",
  "Europe",
  "Africa",
  "Asia",
  "Oceania",
]
const EVIDENCE_KINDS = [
  "forecast",
  "observation",
  "methodology",
  "resolution-source",
  "background",
]

const LUNA_MODEL = process.env.LLM_MODEL?.trim() || "gpt-5.6-luna"

function promptFor(count) {
  return `You are curating ${count} binary (YES/NO) climate prediction markets. Spread them across all six inhabited continents and vary the hazard categories.

Every question must resolve in the FUTURE relative to the provided current date.

Return ONLY a JSON object of the form {"markets": [ ... ]} with no markdown fences and no prose. Each item in "markets" must have exactly these fields:
- question: string (specific YES/NO about future climate/weather, resolving in 30-240 days)
- category: one of ${JSON.stringify(MARKET_CATEGORIES)}
- continent: one of ${JSON.stringify(MARKET_CONTINENTS)}
- country: string (real country, omit if not applicable)
- region: string (real place within that continent)
- latitude: number (accurate)
- longitude: number (accurate)
- closeInDays: integer 30-240
- estimatedProbability: number 0-1 (required; a decimal probability such as 0.22 for 22%, not a percentage)
- resolutionSource: string (real authority e.g. NOAA, NASA, WMO)
- resolutionSourceUrl: string (that source's real official URL)
- resolutionRules: string (precise settlement criteria)
- description: string (1-2 neutral sentences)
- evidence: array of 2-3 objects, each { "title": string, "summary": string, "publisher": string, "url": string (real official URL), "kind": one of ${JSON.stringify(EVIDENCE_KINDS)} }. Only cite well-known official sources.`
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v))
}
function round(v, places = 2) {
  const f = 10 ** places
  return Math.round(v * f) / f
}
function slugify(input) {
  return (
    input
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "market"
  )
}

/**
 * Read a market's opening probability from either the raw model shape
 * (`estimatedProbability`) or the already-validated definition shape
 * (`targetYes`, which is what gets saved to the replayable fixture file).
 * Returns null when absent or unusable so the caller can drop the item —
 * silently defaulting here would open every market at 50/50.
 */
function readEstimate(raw) {
  const value =
    raw?.estimatedProbability ??
    raw?.estimated_probability ??
    raw?.targetYes ??
    raw?.target_yes
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0) return null
  // Tolerate percent-style values ("62") alongside decimals ("0.62").
  const normalized = number > 1 ? number / 100 : number
  if (!Number.isFinite(normalized) || normalized <= 0 || normalized >= 1) {
    return null
  }
  return clamp(normalized, 0.05, 0.95)
}
function normalizeUrl(value) {
  if (typeof value !== "string") return null
  const t = value.trim()
  if (!t) return null
  const c = /^https?:\/\//i.test(t) ? t : `https://${t}`
  try {
    const u = new URL(c)
    if (u.protocol === "http:" || u.protocol === "https:") return u.toString()
  } catch {}
  return null
}
function extractJson(text) {
  const t = text.trim()
  const f = t.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const b = f ? f[1].trim() : t
  const s = b.indexOf("{")
  const e = b.lastIndexOf("}")
  if (s !== -1 && e !== -1 && e > s) return b.slice(s, e + 1)
  return b
}
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
// Deterministic unit uniform for per-market depth variation.
function unitUniform(seedStr) {
  let h = 2166136261
  for (let i = 0; i < seedStr.length; i++) {
    h ^= seedStr.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  h ^= h >>> 13
  h = Math.imul(h, 0x5bd1e995)
  h ^= h >>> 15
  return (h >>> 0) / 4294967296
}

// ---------------------------------------------------------------------------
// Generation + validation (model output -> definition)
// ---------------------------------------------------------------------------

async function callModel(count) {
  const today = new Date().toISOString().slice(0, 10)
  const result = await complete({
    model: LUNA_MODEL,
    userContent: `Today's date is ${today}.\n\n${promptFor(count)}`,
    json: true,
    timeoutMs: GENERATION_TIMEOUT_MS,
  })
  const text = result.text
  if (!text) throw new Error("Model returned an empty response")
  const parsed = JSON.parse(extractJson(text))
  if (!Array.isArray(parsed.markets) || parsed.markets.length === 0) {
    throw new Error("Model response contained no markets")
  }
  return parsed.markets
}

function validateRaw(raw) {
  if (!MARKET_CATEGORIES.includes(raw.category)) return null
  if (!MARKET_CONTINENTS.includes(raw.continent)) return null
  const question = raw.question?.trim()
  const description = raw.description?.trim()
  const region = raw.region?.trim()
  const resolutionSource = raw.resolutionSource?.trim()
  const resolutionRules = raw.resolutionRules?.trim()
  if (
    !question ||
    !description ||
    !region ||
    !resolutionSource ||
    !resolutionRules
  ) {
    return null
  }
  const latitude = Number(raw.latitude)
  const longitude = Number(raw.longitude)
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) return null
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    return null
  }
  const resolutionSourceUrl = normalizeUrl(raw.resolutionSourceUrl)
  if (!resolutionSourceUrl) return null
  // Opening odds are mandatory: without them a market would be seeded at
  // 50/50, which contradicts "markets open at model odds".
  const targetYes = readEstimate(raw)
  if (targetYes === null) return null
  const closeDays = clamp(Math.round(Number(raw.closeInDays) || 60), 7, 300)
  const evidence = []
  const list = Array.isArray(raw.evidence) ? raw.evidence : []
  for (const ev of list) {
    const url = normalizeUrl(ev?.url)
    if (
      !url ||
      !ev?.title?.trim() ||
      !ev?.summary?.trim() ||
      !ev?.publisher?.trim()
    ) {
      continue
    }
    evidence.push({
      title: ev.title.trim().slice(0, 240),
      summary: ev.summary.trim().slice(0, 1000),
      publisher: ev.publisher.trim().slice(0, 160),
      url,
      kind: EVIDENCE_KINDS.includes(ev?.kind) ? ev.kind : "background",
    })
  }
  return {
    question: question.slice(0, 400),
    description: description.slice(0, 2000),
    category: raw.category,
    continent: raw.continent,
    country: raw.country?.trim().slice(0, 100) || undefined,
    region: region.slice(0, 160),
    latitude,
    longitude,
    closeDays,
    targetYes,
    resolutionSource: resolutionSource.slice(0, 300),
    resolutionSourceUrl,
    resolutionRules: resolutionRules.slice(0, 4000),
    evidence,
  }
}

async function loadDefinitions(args) {
  if (args.fixtureFile) {
    console.log(`Loading definitions from ${args.fixtureFile}...`)
    const parsed = JSON.parse(await readFile(args.fixtureFile, "utf-8"))
    const raw = parsed.markets ?? parsed
    if (!Array.isArray(raw) || raw.length === 0) {
      throw new Error("Fixture file contains no markets")
    }
    const valid = raw.map(validateRaw).filter(Boolean)
    console.log(`${valid.length}/${raw.length} fixture definitions valid`)
    return valid
  }

  if (!process.env.BACKBOARD_API_KEY?.trim()) {
    throw new Error(
      "BACKBOARD_API_KEY is not set and no --fixture-file given. Generate once, then replay offline via --fixture-file.",
    )
  }
  const valid = []
  const seen = new Set()
  const batchMax = clamp(
    Math.round(args.batchSize || 25),
    1,
    GENERATION_BATCH_MAX,
  )
  for (let round = 0; valid.length < args.markets && round < 6; round++) {
    const need = Math.min(batchMax, args.markets - valid.length)
    console.log(
      `Generating ${need} market definitions via model (round ${round + 1})...`,
    )
    let raw
    try {
      raw = await callModel(need)
    } catch (err) {
      console.error(`  round ${round + 1} failed: ${err.message} — continuing`)
      continue
    }
    let added = 0
    for (const item of raw) {
      const def = validateRaw(item)
      if (!def) continue
      const key = slugify(def.question)
      if (seen.has(key)) continue
      seen.add(key)
      valid.push(def)
      added++
      if (valid.length >= args.markets) break
    }
    console.log(`  +${added} new (${valid.length}/${args.markets})`)
  }
  if (valid.length === 0) throw new Error("No valid market definitions")
  if (valid.length < args.markets) {
    console.warn(
      `Only ${valid.length} definitions (wanted ${args.markets}) — seeding what we have`,
    )
  }
  return valid
}

// ---------------------------------------------------------------------------
// Market assembly (definition + tape -> seedable market)
// ---------------------------------------------------------------------------

function assembleMarket(
  def,
  globalIndex,
  onchainMarketId,
  depthSol,
  resolver,
  now,
) {
  const id = `market-${slugify(def.question)}-${globalIndex}`.slice(0, 110)
  const slug = `${slugify(def.question)}-${globalIndex}`.slice(0, 110)
  const tape = buildTape({
    marketId: id,
    targetYes: def.targetYes,
    depthSol,
    endTime: now,
  })
  const yes = tape.pools.yesLamports / LAMPORTS_PER_SOL
  const no = tape.pools.noLamports / LAMPORTS_PER_SOL
  const price = tape.pools.yesLamports / tape.pools.totalLamports
  const closeTime = new Date(now + def.closeDays * DAY_MS).toISOString()
  const resolutionTime = new Date(
    now + (def.closeDays + 14) * DAY_MS,
  ).toISOString()
  const evidence = def.evidence.map((ev, ei) => ({
    id: `${id}-evidence-${ei}`,
    ...ev,
    publishedAt: tape.startTime,
  }))
  if (evidence.length === 0) {
    evidence.push({
      id: `${id}-evidence-source`,
      title: def.resolutionSource,
      summary: "Official source proposed for resolution.",
      publisher: def.resolutionSource,
      url: def.resolutionSourceUrl,
      publishedAt: tape.startTime,
      kind: "resolution-source",
    })
  }
  return {
    def,
    tape,
    doc: {
      id,
      onchainMarketId,
      question: def.question,
      slug,
      description: def.description,
      category: def.category,
      continent: def.continent,
      country: def.country,
      region: def.region,
      latitude: def.latitude,
      longitude: def.longitude,
      closeTime,
      resolutionTime,
      status: "open",
      outcome: "unresolved",
      yesPrice: round(price, 4),
      noPrice: round(1 - price, 4),
      yesLiquidity: round(yes, 4),
      noLiquidity: round(no, 4),
      totalVolume: round(tape.totalVolumeSol, 4),
      participants: tape.participants,
      resolutionSource: def.resolutionSource,
      resolutionSourceUrl: def.resolutionSourceUrl,
      resolutionRules: def.resolutionRules,
      resolver,
      createdAt: tape.startTime,
      featured: globalIndex < 4,
      trendingScore: clamp(Math.round(45 + price * 45), 0, 100),
      history: tape.history,
      evidence,
      recentTrades: tape.recentTrades,
      network: "devnet",
      settlementAsset: "SOL",
      marketModel: "pooled-binary",
    },
  }
}

// ---------------------------------------------------------------------------
// Solana builders (instruction discriminators match programs/climate_market)
// ---------------------------------------------------------------------------

let PROGRAM_ID
let connection

function deriveProtocol() {
  return PublicKey.findProgramAddressSync([PROTOCOL_SEED], PROGRAM_ID)[0]
}
function deriveMarket(marketId) {
  const idBuf = Buffer.alloc(8)
  idBuf.writeBigUInt64LE(BigInt(marketId))
  const market = PublicKey.findProgramAddressSync(
    [MARKET_SEED, idBuf],
    PROGRAM_ID,
  )[0]
  const vault = PublicKey.findProgramAddressSync(
    [VAULT_SEED, market.toBuffer()],
    PROGRAM_ID,
  )[0]
  return { market, vault }
}
function derivePositions(marketPda, ownerPubkey) {
  const yesPosition = PublicKey.findProgramAddressSync(
    [YES_POSITION_SEED, marketPda.toBuffer(), ownerPubkey.toBuffer()],
    PROGRAM_ID,
  )[0]
  const noPosition = PublicKey.findProgramAddressSync(
    [NO_POSITION_SEED, marketPda.toBuffer(), ownerPubkey.toBuffer()],
    PROGRAM_ID,
  )[0]
  return { yesPosition, noPosition }
}
function instructionDiscriminator(name) {
  return createHash("sha256").update(`global:${name}`).digest().subarray(0, 8)
}
function buildInitProtocol(protocol, authority, resolver) {
  return {
    programId: PROGRAM_ID,
    keys: [
      { pubkey: protocol, isSigner: false, isWritable: true },
      { pubkey: authority, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([
      instructionDiscriminator("initialize_protocol"),
      resolver.toBuffer(),
    ]),
  }
}
function buildCreateMarket(
  protocol,
  authority,
  market,
  vault,
  marketId,
  questionHash,
  closeTs,
  resolutionTs,
) {
  const idBuf = Buffer.alloc(8)
  idBuf.writeBigUInt64LE(BigInt(marketId))
  const closeBuf = Buffer.alloc(8)
  closeBuf.writeBigInt64LE(BigInt(closeTs))
  const resBuf = Buffer.alloc(8)
  resBuf.writeBigInt64LE(BigInt(resolutionTs))
  return {
    programId: PROGRAM_ID,
    keys: [
      { pubkey: protocol, isSigner: false, isWritable: true },
      { pubkey: market, isSigner: false, isWritable: true },
      { pubkey: vault, isSigner: false, isWritable: true },
      { pubkey: authority, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([
      instructionDiscriminator("create_market"),
      idBuf,
      Buffer.from(questionHash),
      closeBuf,
      resBuf,
    ]),
  }
}
function buildFundMarket(
  protocol,
  market,
  vault,
  yesPos,
  noPos,
  funder,
  yesAmt,
  noAmt,
) {
  const yesBuf = Buffer.alloc(8)
  yesBuf.writeBigUInt64LE(BigInt(yesAmt))
  const noBuf = Buffer.alloc(8)
  noBuf.writeBigUInt64LE(BigInt(noAmt))
  return {
    programId: PROGRAM_ID,
    keys: [
      { pubkey: protocol, isSigner: false, isWritable: false },
      { pubkey: market, isSigner: false, isWritable: true },
      { pubkey: vault, isSigner: false, isWritable: true },
      { pubkey: yesPos, isSigner: false, isWritable: true },
      { pubkey: noPos, isSigner: false, isWritable: true },
      { pubkey: funder, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([
      instructionDiscriminator("fund_market"),
      yesBuf,
      noBuf,
    ]),
  }
}
async function sendTxn(tx, signer) {
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      return await sendAndConfirmTransaction(connection, tx, [signer], {
        commitment: "confirmed",
      })
    } catch (err) {
      if (err.message && err.message.includes("429")) {
        await sleep(1000 * 2 ** attempt)
        continue
      }
      throw err
    }
  }
  throw new Error("Failed after 10 retries (rate limited)")
}

/** Bulk account read with 429 backoff (public Devnet RPC is strict). */
async function getMultipleAccountsWithRetry(addresses) {
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      return await connection.getMultipleAccountsInfo(addresses)
    } catch (err) {
      if (err.message && err.message.includes("429") && attempt < 7) {
        const wait = 2000 * 2 ** attempt
        console.log(`  RPC rate-limited, retrying in ${wait / 1000}s...`)
        await sleep(wait)
        continue
      }
      throw err
    }
  }
  throw new Error("Failed after 8 retries (rate limited)")
}

// ---------------------------------------------------------------------------
// Seed command
// ---------------------------------------------------------------------------

function buildCloseMarket(protocol, market, closer) {
  return {
    programId: PROGRAM_ID,
    keys: [
      { pubkey: protocol, isSigner: false, isWritable: false },
      { pubkey: market, isSigner: false, isWritable: true },
      { pubkey: closer, isSigner: true, isWritable: false },
    ],
    data: Buffer.concat([instructionDiscriminator("close_market")]),
  }
}

const RESOLUTION_DECISIONS = { yes: 0, no: 1, cancelled: 2 }

function buildResolveMarket(protocol, market, resolver, decision) {
  return {
    programId: PROGRAM_ID,
    keys: [
      { pubkey: protocol, isSigner: false, isWritable: false },
      { pubkey: market, isSigner: false, isWritable: true },
      { pubkey: resolver, isSigner: true, isWritable: false },
    ],
    data: Buffer.concat([
      instructionDiscriminator("resolve_market"),
      Buffer.from([decision]),
    ]),
  }
}

/**
 * Deterministic outcome draw against model odds. Reproducible per market id,
 * never hand-picked. Model odds are recovered from the tape's opening point
 * (genesis liquidity is seeded exactly at the model's estimated probability).
 */
function resolveDraw(marketId, modelOdds) {
  return unitUniform(`resolve|${marketId}`) < modelOdds ? "yes" : "no"
}

function modelOddsOf(doc) {
  const first = Array.isArray(doc.history) ? doc.history[0] : null
  const odds =
    typeof first?.yesProbability === "number"
      ? first.yesProbability
      : typeof doc.yesPrice === "number"
        ? doc.yesPrice
        : 0.5
  return clamp(Number(odds) || 0.5, 0.05, 0.95)
}

function loadWallet(requireIt) {
  const walletPath = join(homedir(), ".config", "solana", "id.json")
  try {
    const secret = JSON.parse(readFileSync(walletPath, "utf-8"))
    const wallet = Keypair.fromSecretKey(Uint8Array.from(secret))
    console.log(`Wallet: ${wallet.publicKey.toBase58()}`)
    return wallet
  } catch {
    if (requireIt) {
      console.error(`No Solana keypair found at ${walletPath}`)
      process.exit(1)
    }
    return null
  }
}

/**
 * Assemble definitions into seedable markets (tapes + docs). Shared by
 * `seed` and `roll` top-up.
 */
function assembleAll(defs, { baseId, budgetTotal, resolver, now }) {
  const meanDepth = budgetTotal / defs.length
  const markets = defs.map((def, i) => {
    const u = unitUniform(`depth|${def.question}|${i}`)
    const depthSol = clamp(meanDepth * (0.4 + 1.2 * u), 0.015, 0.2)
    return assembleMarket(def, i, baseId + i, depthSol, resolver, now)
  })
  const fundingTotal = markets.reduce(
    (a, m) => a + m.tape.pools.totalLamports,
    0,
  )
  return { markets, fundingTotal }
}

/**
 * Exact pre-write budget: pool funding + rent for not-yet-created PDAs +
 * protocol rent when uninitialized + fee buffer. Read-only.
 */
async function checkBudget(markets, fundingTotal) {
  const addresses = markets.map(
    (m) => deriveMarket(m.doc.onchainMarketId).market,
  )
  const infos = []
  for (let i = 0; i < addresses.length; i += 100) {
    infos.push(
      ...(await getMultipleAccountsWithRetry(addresses.slice(i, i + 100))),
    )
  }
  const newCount = infos.filter((info) => !info).length
  const [rentMarket, rentVault] = await Promise.all([
    connection.getMinimumBalanceForRentExemption(MARKET_SPACE),
    connection.getMinimumBalanceForRentExemption(VAULT_SPACE),
  ])
  let rentTotal = newCount * (rentMarket + rentVault)
  const protocolPda = deriveProtocol()
  const protocolMissing = !(await connection.getAccountInfo(protocolPda))
  if (protocolMissing) {
    rentTotal +=
      await connection.getMinimumBalanceForRentExemption(PROTOCOL_SPACE)
  }
  return { newCount, rentTotal, fundingTotal, protocolMissing }
}

function printBudget({ fundingTotal, rentTotal, newCount }) {
  const needLamports = fundingTotal + rentTotal + FEE_BUFFER_LAMPORTS
  console.log(
    `Budget: funding ${(fundingTotal / LAMPORTS_PER_SOL).toFixed(4)} SOL + ` +
      `rent ${(rentTotal / LAMPORTS_PER_SOL).toFixed(4)} SOL (${newCount} new markets) + ` +
      `fees ${(FEE_BUFFER_LAMPORTS / LAMPORTS_PER_SOL).toFixed(4)} SOL = ` +
      `${(needLamports / LAMPORTS_PER_SOL).toFixed(4)} SOL needed`,
  )
  return needLamports
}

async function requireFunds(wallet, needLamports, force) {
  const balance = await connection.getBalance(wallet.publicKey)
  console.log(`Wallet balance: ${(balance / LAMPORTS_PER_SOL).toFixed(4)} SOL`)
  if (balance < needLamports && !force) {
    console.error(
      `Insufficient funds: need ${(needLamports / LAMPORTS_PER_SOL).toFixed(4)} SOL, ` +
        `have ${(balance / LAMPORTS_PER_SOL).toFixed(4)} SOL. Fund the wallet or pass --force.`,
    )
    process.exit(1)
  }
}

/**
 * Fund on-chain pools + index to SQLite. Shared by `seed` and `roll` top-up.
 */
async function fundAndIndex(markets, { wallet, indexDb, reset }) {
  // Bulk existence check up front: one RPC call per 100 markets instead of
  // one per market (public Devnet RPC rate-limits hard on sequential reads).
  let existingIds = new Set()
  if (wallet) {
    const addresses = markets.map(
      (m) => deriveMarket(m.doc.onchainMarketId).market,
    )
    const infos = []
    for (let i = 0; i < addresses.length; i += 100) {
      infos.push(
        ...(await getMultipleAccountsWithRetry(addresses.slice(i, i + 100))),
      )
    }
    existingIds = new Set(
      markets.filter((_, i) => infos[i]).map((m) => m.doc.onchainMarketId),
    )
    const protocolPda = deriveProtocol()
    if (!(await connection.getAccountInfo(protocolPda))) {
      console.log("Initializing protocol...")
      await sendTxn(
        new Transaction().add(
          buildInitProtocol(protocolPda, wallet.publicKey, wallet.publicKey),
        ),
        wallet,
      )
      await sleep(1500)
    } else {
      console.log("Protocol already initialized")
    }
    for (const m of markets) {
      const { market, vault } = deriveMarket(m.doc.onchainMarketId)
      if (existingIds.has(m.doc.onchainMarketId)) {
        console.log(`  [${m.doc.onchainMarketId}] already exists, skipping`)
        continue
      }
      const qHash = createHash("sha256").update(m.doc.question).digest()
      const closeTs = Math.floor(Date.parse(m.doc.closeTime) / 1000)
      const resTs = Math.floor(Date.parse(m.doc.resolutionTime) / 1000)
      console.log(
        `  [${m.doc.onchainMarketId}] creating: ${m.doc.question.slice(0, 70)}...`,
      )
      await sendTxn(
        new Transaction().add(
          buildCreateMarket(
            protocolPda,
            wallet.publicKey,
            market,
            vault,
            m.doc.onchainMarketId,
            qHash,
            closeTs,
            resTs,
          ),
        ),
        wallet,
      )
      await sleep(1500)
      const { yesPosition, noPosition } = derivePositions(
        market,
        wallet.publicKey,
      )
      console.log(
        `  [${m.doc.onchainMarketId}] funding ${(m.tape.pools.yesLamports / LAMPORTS_PER_SOL).toFixed(4)} / ` +
          `${(m.tape.pools.noLamports / LAMPORTS_PER_SOL).toFixed(4)} SOL`,
      )
      await sendTxn(
        new Transaction().add(
          buildFundMarket(
            protocolPda,
            market,
            vault,
            yesPosition,
            noPosition,
            wallet.publicKey,
            m.tape.pools.yesLamports,
            m.tape.pools.noLamports,
          ),
        ),
        wallet,
      )
      await sleep(1500)
    }
  }

  if (indexDb) {
    console.log("Indexing to SQLite...")
    if (reset) {
      resetMarketData()
      console.log("  Reset: dropped market data (schema + indexes persist)")
    }
    for (const m of markets) {
      const d = m.doc
      upsertMarket({
        marketId: d.id,
        onchainMarketId: d.onchainMarketId,
        title: d.question,
        question: d.question,
        description: d.description,
        slug: d.slug,
        category: d.category,
        continent: d.continent,
        country: d.country ?? null,
        region: d.region,
        latitude: d.latitude,
        longitude: d.longitude,
        resolutionSource: d.resolutionSource,
        resolutionSourceUrl: d.resolutionSourceUrl,
        resolutionRules: d.resolutionRules,
        status: d.status,
        outcome: d.outcome,
        yesPrice: d.yesPrice,
        noPrice: d.noPrice,
        yesLiquidity: d.yesLiquidity,
        noLiquidity: d.noLiquidity,
        totalVolume: d.totalVolume,
        participants: d.participants,
        featured: d.featured,
        trendingScore: d.trendingScore,
        resolver: d.resolver,
        evidence: d.evidence,
        recentTrades: d.recentTrades,
        createdAt: d.createdAt,
        closeTime: d.closeTime,
        resolutionTime: d.resolutionTime,
      })
      replaceHistory(d.id, d.history)
      seedParticipants(d.id, [...new Set(m.tape.trades.map((t) => t.wallet))])
      replaceCreationSnapshots(d.id, d.history)
    }
    console.log(`  SQLite: indexed ${markets.length} markets`)
  }
}

/**
 * Close every open market past its close time (on-chain + DB).
 * With dry=true, only lists what would close.
 * Returns { closed, failed }.
 */
async function closeDueMarkets(wallet, dry = false) {
  const now = new Date().toISOString()
  const due = dueToClose(now)
  if (dry) {
    for (const doc of due) {
      console.log(
        `  would close ${doc.onchain_market_id}: ${doc.question?.slice(0, 60)}...`,
      )
    }
    return { closed: [], failed: [] }
  }
  const closed = []
  const failed = []
  for (const doc of due) {
    const { market } = deriveMarket(doc.onchain_market_id)
    try {
      if (wallet) {
        const protocolPda = deriveProtocol()
        await sendTxn(
          new Transaction().add(
            buildCloseMarket(protocolPda, market, wallet.publicKey),
          ),
          wallet,
        )
        await sleep(1500)
      }
      updateMarketStatus(doc.market_id, "closed")
      closed.push(doc.market_id)
      console.log(
        `  closed ${doc.onchain_market_id}: ${doc.question?.slice(0, 60)}...`,
      )
    } catch (err) {
      failed.push(doc.market_id)
      console.error(`  CLOSE FAILED ${doc.onchain_market_id}: ${err.message}`)
    }
  }
  return { closed, failed }
}

/**
 * Resolve every closed market past its resolution time (seeded draw +
 * on-chain + DB + resolution record + position settlement flags).
 * With dry=true, only lists what would resolve (with drawn outcomes).
 * Returns { resolved, failed }.
 */
async function resolveDueMarkets(wallet, dry = false) {
  const now = new Date().toISOString()
  const due = dueToResolve(now)
  if (dry) {
    for (const doc of due) {
      const outcome = resolveDraw(doc.marketId, modelOddsOf(doc))
      console.log(
        `  would resolve ${doc.onchainMarketId} -> ${outcome.toUpperCase()}`,
      )
    }
    return { resolved: [], failed: [] }
  }
  const resolved = []
  const failed = []
  for (const doc of due) {
    const outcome = resolveDraw(doc.marketId, modelOddsOf(doc))
    const decision = RESOLUTION_DECISIONS[outcome]
    try {
      let signature = null
      if (wallet) {
        const protocolPda = deriveProtocol()
        const { market } = deriveMarket(doc.onchainMarketId)
        signature = await sendTxn(
          new Transaction().add(
            buildResolveMarket(protocolPda, market, wallet.publicKey, decision),
          ),
          wallet,
        )
        await sleep(1500)
      }
      updateMarketStatus(doc.marketId, "resolved", outcome)
      insertResolution({
        marketDocId: doc.marketId,
        resolvedOutcome: outcome,
        resolverType: "automated",
        resolverWallet: wallet ? wallet.publicKey.toBase58() : "lifecycle",
        proofUrl: signature
          ? `https://explorer.solana.com/tx/${signature}?cluster=devnet`
          : undefined,
      })
      const { won, lost } = settlePositionsByMarket(doc.marketId, outcome)
      if (signature) {
        insertTransaction({
          walletAddress: wallet.publicKey.toBase58(),
          type: "market_resolved",
          txSignature: signature,
          status: "confirmed",
          marketDocId: doc.marketId,
          onchainMarketId: doc.onchainMarketId,
        })
      }
      resolved.push(doc.marketId)
      console.log(
        `  resolved ${doc.onchainMarketId} -> ${outcome.toUpperCase()} ` +
          `(winners: ${won}, losers: ${lost})`,
      )
    } catch (err) {
      failed.push(doc.marketId)
      console.error(`  RESOLVE FAILED ${doc.onchainMarketId}: ${err.message}`)
    }
  }
  return { resolved, failed }
}

async function seed(args) {
  loadEnv()
  PROGRAM_ID = requireProgramId()
  connection = new Connection(resolveRpcUrl(), "confirmed")

  const wallet = loadWallet(!args.skipChain)

  // --- Phase 1: definitions ---
  const defs = await loadDefinitions(args)
  const count = args.fixtureFile
    ? defs.length
    : Math.min(defs.length, args.markets)
  const chosen = defs.slice(0, count)

  // Save validated definitions for offline replay.
  const defsDir = join(tmpdir(), "clyma")
  await mkdir(defsDir, { recursive: true })
  const defsPath = join(defsDir, `seed-definitions-${Date.now()}.json`)
  await writeFile(
    defsPath,
    JSON.stringify({ markets: chosen }, null, 2),
    "utf-8",
  )
  console.log(`Definitions saved to ${defsPath} (replay with --fixture-file)`)

  // --- Phase 2: tapes + assembly ---
  const now = Date.now()
  const { markets, fundingTotal } = assembleAll(chosen, {
    baseId: args.baseId,
    budgetTotal: args.budget,
    resolver: wallet
      ? wallet.publicKey.toBase58()
      : "11111111111111111111111111111111",
    now,
  })
  console.log(
    `${markets.length} markets assembled, pool funding total: ` +
      `${(fundingTotal / LAMPORTS_PER_SOL).toFixed(4)} SOL (depth budget ${args.budget})`,
  )

  // --- Phase 3: budget preflight (exact, before any write) ---
  const budget =
    !args.skipChain && wallet
      ? await checkBudget(markets, fundingTotal)
      : {
          newCount: markets.length,
          rentTotal: 0,
          fundingTotal,
          protocolMissing: false,
        }
  const needLamports = printBudget(budget)
  if (args.dryRun) {
    console.log("Dry run — no chain or DB writes. Exiting.")
    return
  }
  if (!args.skipChain && wallet) {
    await requireFunds(wallet, needLamports, args.force)
  }

  await fundAndIndex(markets, {
    wallet: args.skipChain ? null : wallet,
    indexDb: !args.skipDb,
    reset: args.reset,
  })

  console.log(
    `\nDone! Markets ${args.baseId}–${args.baseId + markets.length - 1} ` +
      `(${markets.length} markets, ${(fundingTotal / LAMPORTS_PER_SOL).toFixed(4)} SOL pools)`,
  )
}

// ---------------------------------------------------------------------------
// close: shut expired markets (on-chain + DB)
// ---------------------------------------------------------------------------

async function closeCommand(args) {
  loadEnv()
  PROGRAM_ID = requireProgramId()
  connection = new Connection(resolveRpcUrl(), "confirmed")

  const wallet = loadWallet(true)
  const { closed, failed } = await closeDueMarkets(wallet, args.dryRun)
  if (args.dryRun) {
    console.log("\nDry run — no writes.")
    return
  }
  console.log(`\nClosed ${closed.length} markets, ${failed.length} failed`)
  if (failed.length > 0) process.exit(1)
}

// ---------------------------------------------------------------------------
// resolve: settle due markets by seeded draw (on-chain + DB)
// ---------------------------------------------------------------------------

async function resolveCommand(args) {
  loadEnv()
  PROGRAM_ID = requireProgramId()
  connection = new Connection(resolveRpcUrl(), "confirmed")

  const wallet = loadWallet(true)
  const { resolved, failed } = await resolveDueMarkets(wallet, args.dryRun)
  if (args.dryRun) {
    console.log("\nDry run — no writes.")
    return
  }
  console.log(`\nResolved ${resolved.length} markets, ${failed.length} failed`)
  if (failed.length > 0) process.exit(1)
}

// ---------------------------------------------------------------------------
// roll: close + resolve + top up to a target live count
// ---------------------------------------------------------------------------

async function rollCommand(args) {
  loadEnv()
  PROGRAM_ID = requireProgramId()
  connection = new Connection(resolveRpcUrl(), "confirmed")

  const target = Number.isFinite(args.markets) ? args.markets : 100
  const wallet = loadWallet(true)

  console.log("Step 1: closing expired markets...")
  const closed = await closeDueMarkets(wallet, args.dryRun)
  console.log("Step 2: resolving due markets...")
  const resolved = await resolveDueMarkets(wallet, args.dryRun)

  const openCount = countOpenMarkets()
  const needed = target - openCount
  console.log(
    `Open markets: ${openCount}, target: ${target}, needed: ${Math.max(0, needed)}`,
  )
  if (needed <= 0) {
    console.log("Nothing to top up.")
    return
  }

  console.log(`Step 3: topping up ${needed} markets...`)
  const defs = await loadDefinitions({ ...args, markets: needed })
  const chosen = defs.slice(0, needed)
  if (chosen.length < needed) {
    console.warn(
      `Only ${chosen.length} definitions for ${needed} needed — proceeding`,
    )
  }
  if (chosen.length === 0) {
    console.error("No definitions to top up with")
    process.exit(1)
  }

  const maxOnchain = maxOnchainMarketId()
  const baseId = (maxOnchain ?? args.baseId - 1) + 1
  // Pro-rate the pool budget to the markets actually created.
  const budgetTotal = args.budgetExplicit
    ? args.budget
    : (args.budget / target) * chosen.length
  const now = Date.now()
  const { markets, fundingTotal } = assembleAll(chosen, {
    baseId,
    budgetTotal,
    resolver: wallet.publicKey.toBase58(),
    now,
  })
  console.log(
    `${markets.length} markets assembled from ID ${baseId}, pool funding total: ` +
      `${(fundingTotal / LAMPORTS_PER_SOL).toFixed(4)} SOL`,
  )

  if (args.dryRun) {
    console.log("Dry run — no chain or DB writes. Exiting.")
    return
  }
  const budget = await checkBudget(markets, fundingTotal)
  const needLamports = printBudget(budget)
  await requireFunds(wallet, needLamports, args.force)

  await fundAndIndex(markets, { wallet, indexDb: true, reset: false })

  console.log(
    `\nRoll done! closed=${closed.closed.length} resolved=${resolved.resolved.length} ` +
      `topped-up=${markets.length} (IDs ${baseId}–${baseId + markets.length - 1})`,
  )
}

// ---------------------------------------------------------------------------
// boost: top up existing pools to a wide depth spread (chain + DB)
// ---------------------------------------------------------------------------

const BOOST_SIGMA = 1.2
const BOOST_DRIFT_TOL_SOL = 0.0006

// programs/climate_market/src/state.rs Market layout: discriminator 8,
// protocol/authority/resolver 32x3, market_id u64, question_hash 32,
// close/resolution i64 x2, status u8 @160, outcome u8 @161,
// total_yes u64 @162, total_no u64 @170, total_pool u64 @178.
const POOL_YES_OFFSET = 162
const POOL_NO_OFFSET = 170
const POOL_TOTAL_OFFSET = 178
const POOL_MIN_BYTES = 186
/** MarketStatus::Open discriminant. */
const MARKET_STATUS_OPEN = 0

function decodeMarketPools(info) {
  if (!info) return null
  const d = info.data
  if (!d || d.length < POOL_MIN_BYTES) return null
  return {
    yes: Number(d.readBigUInt64LE(POOL_YES_OFFSET)) / LAMPORTS_PER_SOL,
    no: Number(d.readBigUInt64LE(POOL_NO_OFFSET)) / LAMPORTS_PER_SOL,
    total: Number(d.readBigUInt64LE(POOL_TOTAL_OFFSET)) / LAMPORTS_PER_SOL,
    status: d[160],
  }
}

/** Sum of 3 unit uniforms, recentered: approx Normal(0, 1). */
function normalFromUniforms(seedTag, key) {
  const sum =
    unitUniform(`${seedTag}|${key}|a`) +
    unitUniform(`${seedTag}|${key}|b`) +
    unitUniform(`${seedTag}|${key}|c`)
  return (sum - 1.5) * 2
}

/**
 * Plan per-market pool targets summing to `targetTotalSol` (pure).
 *
 * Depths are lognormal (median ~= the mean market depth), clamped to
 * [minDepthSol, maxDepthSol], then scaled so the targets sum exactly to the
 * total. Each target is split at the market's CURRENT yes ratio, so funding
 * the delta never moves the odds. Markets already at/above target get no
 * funding (addTotal 0). Deterministic per seedTag + onchain ids.
 */
function planBoostDepths(
  markets,
  { targetTotalSol, minDepthSol, maxDepthSol, seedTag },
) {
  // Funding is one-sided (pools only grow), so raw targets summing to the
  // total would overshoot by the surplus of markets already above target.
  // Solve for the smaller input total whose FUNDED result lands on target
  // (binary search; the funded final is monotonic in the input total).
  const targetLamports = Math.round(targetTotalSol * LAMPORTS_PER_SOL)
  const chainLamports = markets.reduce(
    (a, m) =>
      a +
      Math.round(m.curYesSol * LAMPORTS_PER_SOL) +
      Math.round(m.curNoSol * LAMPORTS_PER_SOL),
    0,
  )
  const planWith = (inputTotalSol) =>
    planBoostRaw(markets, {
      targetTotalSol: inputTotalSol,
      minDepthSol,
      maxDepthSol,
      seedTag,
    })
  const fundedFinal = (inputTotalSol) =>
    chainLamports + planWith(inputTotalSol).reduce((a, p) => a + p.addTotal, 0)
  if (chainLamports >= targetLamports) return planWith(targetTotalSol)
  let lo = 0
  let hi = targetTotalSol
  for (let i = 0; i < 25; i++) {
    const mid = (lo + hi) / 2
    if (fundedFinal(mid) < targetLamports) lo = mid
    else hi = mid
  }
  return planWith(hi)
}

function planBoostRaw(
  markets,
  { targetTotalSol, minDepthSol, maxDepthSol, seedTag },
) {
  const mean = targetTotalSol / markets.length
  const mu = Math.log(mean) - (BOOST_SIGMA * BOOST_SIGMA) / 2
  const raw = markets.map((m) => {
    const depth = Math.exp(
      mu + BOOST_SIGMA * normalFromUniforms(seedTag, m.onchainMarketId),
    )
    return Math.min(maxDepthSol, Math.max(minDepthSol, depth))
  })
  const rawSum = raw.reduce((a, b) => a + b, 0)
  const scale = targetTotalSol / rawSum
  return markets.map((m, i) => {
    const curYes = Math.round(m.curYesSol * LAMPORTS_PER_SOL)
    const curNo = Math.round(m.curNoSol * LAMPORTS_PER_SOL)
    const curTotal = curYes + curNo
    const targetTotal = Math.round(raw[i] * scale * LAMPORTS_PER_SOL)
    const yesRatio = curTotal > 0 ? curYes / curTotal : 0.5
    const targetYes = Math.round(targetTotal * yesRatio)
    const targetNo = targetTotal - targetYes
    const addYes = Math.max(0, targetYes - curYes)
    const addNo = Math.max(0, targetNo - curNo)
    return {
      ...m,
      curYes,
      curNo,
      curTotal,
      targetYes,
      targetNo,
      targetTotal,
      addYes,
      addNo,
      addTotal: addYes + addNo,
    }
  })
}

async function boostCommand(args) {
  loadEnv()
  PROGRAM_ID = requireProgramId()
  connection = new Connection(resolveRpcUrl(), "confirmed")
  const wallet = loadWallet(true)
  const funder = wallet.publicKey.toBase58()

  const { targetTotal, minDepth, maxDepth, boostSeed } = args

  // --- Step 1: chain pools (source of truth) + DB rows ---
  const dbRows = listOpenMarketPools()
  if (dbRows.length === 0) {
    console.error("No open markets in the DB — nothing to boost")
    process.exit(1)
  }
  console.log(`Reading chain pools for ${dbRows.length} open markets...`)
  const addresses = dbRows.map((r) => deriveMarket(r.onchainMarketId).market)
  const infos = []
  for (let i = 0; i < addresses.length; i += 100) {
    infos.push(
      ...(await getMultipleAccountsWithRetry(addresses.slice(i, i + 100))),
    )
  }
  const markets = []
  dbRows.forEach((row, i) => {
    const decoded = decodeMarketPools(infos[i])
    if (!decoded) {
      console.log(`  [${row.onchainMarketId}] missing on-chain, skipping`)
      return
    }
    if (decoded.status !== MARKET_STATUS_OPEN) {
      console.log(
        `  [${row.onchainMarketId}] on-chain status=${decoded.status}, skipping`,
      )
      return
    }
    markets.push({
      marketDocId: row.marketDocId,
      onchainMarketId: row.onchainMarketId,
      curYesSol: decoded.yes,
      curNoSol: decoded.no,
      dbTotalSol: (row.yesLiquidity ?? 0) + (row.noLiquidity ?? 0),
    })
  })
  if (markets.length === 0) {
    console.error("No fundable markets found on-chain")
    process.exit(1)
  }

  // --- Step 2: plan ---
  const plan = planBoostDepths(markets, {
    targetTotalSol: targetTotal,
    minDepthSol: minDepth,
    maxDepthSol: maxDepth,
    seedTag: boostSeed,
  })
  const chainTotal = plan.reduce((a, p) => a + p.curTotal, 0)
  const fundTotal = plan.reduce((a, p) => a + p.addTotal, 0)
  let drifted = 0
  for (const p of plan) {
    const dbTotalLamports = Math.round(p.dbTotalSol * LAMPORTS_PER_SOL)
    const drift = Math.abs(p.curTotal - dbTotalLamports) / LAMPORTS_PER_SOL
    p.driftSol = drift
    if (drift > BOOST_DRIFT_TOL_SOL) drifted++
    const flag =
      p.addTotal > 0
        ? "BOOST "
        : drift > BOOST_DRIFT_TOL_SOL
          ? "FIX   "
          : "ok    "
    console.log(
      `  ${flag} [${p.onchainMarketId}] ` +
        `cur ${(p.curTotal / LAMPORTS_PER_SOL).toFixed(4)} -> ` +
        `target ${(p.targetTotal / LAMPORTS_PER_SOL).toFixed(4)} ` +
        `add +${(p.addTotal / LAMPORTS_PER_SOL).toFixed(4)} ` +
        `(yes +${(p.addYes / LAMPORTS_PER_SOL).toFixed(4)} / ` +
        `no +${(p.addNo / LAMPORTS_PER_SOL).toFixed(4)})` +
        (drift > BOOST_DRIFT_TOL_SOL && p.addTotal === 0
          ? ` drift ${drift.toFixed(4)}`
          : ""),
    )
  }
  console.log(
    `Chain total ${(chainTotal / LAMPORTS_PER_SOL).toFixed(4)} SOL, ` +
      `projected final ${((chainTotal + fundTotal) / LAMPORTS_PER_SOL).toFixed(4)} SOL ` +
      `(target ${targetTotal.toFixed(4)}), ` +
      `to fund +${(fundTotal / LAMPORTS_PER_SOL).toFixed(4)} SOL, ` +
      `${drifted} drifted`,
  )

  if (args.dryRun) {
    console.log("Dry run — no chain or DB writes. Exiting.")
    return
  }
  await requireFunds(wallet, fundTotal + FEE_BUFFER_LAMPORTS, args.force)

  // --- Step 3: fund on-chain (continue past single-tx failures) ---
  const protocolPda = deriveProtocol()
  const funded = []
  const failed = []
  for (const p of plan) {
    if (p.addTotal === 0) continue
    const { market, vault } = deriveMarket(p.onchainMarketId)
    const { yesPosition, noPosition } = derivePositions(
      market,
      wallet.publicKey,
    )
    try {
      const signature = await sendTxn(
        new Transaction().add(
          buildFundMarket(
            protocolPda,
            market,
            vault,
            yesPosition,
            noPosition,
            wallet.publicKey,
            p.addYes,
            p.addNo,
          ),
        ),
        wallet,
      )
      funded.push({ ...p, signature })
      console.log(
        `  [${p.onchainMarketId}] funded +${(p.addTotal / LAMPORTS_PER_SOL).toFixed(4)} SOL (${signature.slice(0, 12)}...)`,
      )
    } catch (err) {
      failed.push(p.onchainMarketId)
      console.error(`  FUND FAILED ${p.onchainMarketId}: ${err.message}`)
    }
    await sleep(1500)
  }

  // --- Step 4: re-read funded pools (exact), write DB ---
  if (funded.length > 0) {
    const fundedAddrs = funded.map(
      (p) => deriveMarket(p.onchainMarketId).market,
    )
    const reInfos = []
    for (let i = 0; i < fundedAddrs.length; i += 100) {
      reInfos.push(
        ...(await getMultipleAccountsWithRetry(fundedAddrs.slice(i, i + 100))),
      )
    }
    funded.forEach((p, i) => {
      const decoded = decodeMarketPools(reInfos[i])
      if (decoded) {
        p.finalYes = decoded.yes
        p.finalNo = decoded.no
      } else {
        p.finalYes = (p.curYes + p.addYes) / LAMPORTS_PER_SOL
        p.finalNo = (p.curNo + p.addNo) / LAMPORTS_PER_SOL
      }
    })
  }
  const timestamp = new Date().toISOString()
  const writePlan = (p, finalYes, finalNo) => {
    const total = finalYes + finalNo
    const yesPrice = total > 0 ? finalYes / total : 0.5
    updateMarketPools(p.marketDocId, {
      yesPrice: round(yesPrice, 4),
      noPrice: round(1 - yesPrice, 4),
      yesLiquidity: round(finalYes, 4),
      noLiquidity: round(finalNo, 4),
      totalVolume: round(total, 4),
    })
    appendHistoryPoint(p.marketDocId, {
      timestamp,
      yesProbability: round(yesPrice, 4),
      noProbability: round(1 - yesPrice, 4),
      totalVolume: round(total, 4),
      yesLiquidity: round(finalYes, 4),
      noLiquidity: round(finalNo, 4),
    })
    insertPriceSnapshot({
      marketDocId: p.marketDocId,
      timestamp,
      yesPrice: round(yesPrice, 4),
      noPrice: round(1 - yesPrice, 4),
      volume: round(p.addTotal / LAMPORTS_PER_SOL, 4),
      triggerEvent: "boost",
      yesLiquidity: round(finalYes, 4),
      noLiquidity: round(finalNo, 4),
      totalVolume: round(total, 4),
    })
    seedParticipants(p.marketDocId, [funder])
  }
  let historyPoints = 0
  // Mirrors the tape's payout convention (amount / probability, 4dp).
  const legPayout = (amountLamports, probability) =>
    Math.round(
      (amountLamports / LAMPORTS_PER_SOL / Math.max(0.0001, probability)) *
        10_000,
    ) / 10_000
  for (const p of funded) {
    writePlan(p, p.finalYes, p.finalNo)
    historyPoints++
    if (p.addYes > 0 || p.addNo > 0) {
      const legs = []
      const yesProb = p.targetYes / Math.max(1, p.targetTotal)
      const noProb = p.targetNo / Math.max(1, p.targetTotal)
      if (p.addYes > 0) {
        legs.push({
          id: `${p.marketDocId}-boost-yes`,
          marketId: p.marketDocId,
          side: "yes",
          amountSol: p.addYes / LAMPORTS_PER_SOL,
          amountLamports: String(p.addYes),
          probability: round(yesProb, 4),
          estimatedPayoutSol: legPayout(p.addYes, yesProb),
          wallet: funder,
          timestamp,
        })
      }
      if (p.addNo > 0) {
        legs.push({
          id: `${p.marketDocId}-boost-no`,
          marketId: p.marketDocId,
          side: "no",
          amountSol: p.addNo / LAMPORTS_PER_SOL,
          amountLamports: String(p.addNo),
          probability: round(noProb, 4),
          estimatedPayoutSol: legPayout(p.addNo, noProb),
          wallet: funder,
          timestamp,
        })
      }
      appendRecentTrades(p.marketDocId, legs)
    }
  }
  // Drift-only markets: repair DB pools (no funding, still chart the fix).
  let repaired = 0
  for (const p of plan) {
    if (p.addTotal > 0 || p.driftSol <= BOOST_DRIFT_TOL_SOL) continue
    if (failed.includes(p.onchainMarketId)) continue
    writePlan(p, p.curYes / LAMPORTS_PER_SOL, p.curNo / LAMPORTS_PER_SOL)
    historyPoints++
    repaired++
  }

  console.log(
    `\nBoost done! funded=${funded.length} failed=${failed.length} ` +
      `drift-repaired=${repaired} history-points=${historyPoints}` +
      (failed.length > 0 ? ` (failed ids: ${failed.join(",")})` : ""),
  )
  if (failed.length > 0) process.exit(1)
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

const USAGE = `Usage:
  node scripts/lifecycle.mjs seed [--markets 100] [--budget 6.5]
    [--base-id 3001] [--batch-size 25] [--fixture-file PATH] [--reset]
    [--skip-chain] [--skip-db] [--dry-run] [--force]

  node scripts/lifecycle.mjs close
    Close every open market past its close time (on-chain + DB).

  node scripts/lifecycle.mjs resolve
    Resolve every closed market past its resolution time by seeded draw
    against model odds (on-chain + DB + resolution record). Outcomes are
    deterministic per market id, never hand-picked.

  node scripts/lifecycle.mjs roll [--markets 100] [--budget SOL]
    [--fixture-file PATH] [--dry-run] [--force]
    close + resolve, then top up to <markets> open markets. Pool budget
    pro-rates to markets actually created; pass --budget to set the top-up
    total explicitly.

  node scripts/lifecycle.mjs boost [--target-total 15] [--min-depth 0.02]
    [--max-depth 1.5] [--seed-tag boost] [--dry-run] [--force]
    Top up EXISTING open-market pools to a wide depth spread summing to
    <target-total> SOL. Depths are lognormal (seeded), clamped to
    [min-depth, max-depth]; each market is funded at its current YES ratio
    so odds never move. Also repairs DB pools that drifted from chain
    (e.g. after live trades). Prints the per-market plan; --dry-run writes
    nothing.

  Resolution is permissioned: this script's wallet is the resolver. There is
  no oracle or dispute process (prototype).`

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.command === "close") {
    await closeCommand(args)
    return
  }
  if (args.command === "resolve") {
    await resolveCommand(args)
    return
  }
  if (args.command === "roll") {
    if (!Number.isFinite(args.markets) || args.markets <= 0) {
      console.error("--markets must be a positive number")
      process.exit(1)
    }
    if (
      args.budgetExplicit &&
      (!Number.isFinite(args.budget) || args.budget <= 0)
    ) {
      console.error("--budget must be a positive number")
      process.exit(1)
    }
    await rollCommand(args)
    return
  }
  if (args.command === "boost") {
    if (!Number.isFinite(args.targetTotal) || args.targetTotal <= 0) {
      console.error("--target-total must be a positive number")
      process.exit(1)
    }
    if (
      !Number.isFinite(args.minDepth) ||
      args.minDepth <= 0 ||
      !Number.isFinite(args.maxDepth) ||
      args.maxDepth < args.minDepth
    ) {
      console.error("--min-depth/--max-depth must be positive with max >= min")
      process.exit(1)
    }
    await boostCommand(args)
    return
  }
  if (args.command !== "seed") {
    console.error(USAGE)
    process.exit(1)
  }
  if (!Number.isFinite(args.markets) || args.markets <= 0) {
    console.error("--markets must be a positive number")
    process.exit(1)
  }
  if (!Number.isFinite(args.budget) || args.budget <= 0) {
    console.error("--budget must be a positive number")
    process.exit(1)
  }
  if (args.skipChain && args.skipDb) {
    console.error("Cannot pass --skip-chain and --skip-db together")
    process.exit(1)
  }
  await seed(args)
}

const cliEntry =
  typeof process.argv[1] === "string" &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (cliEntry) {
  main().catch((err) => {
    console.error("FAIL:", err.message)
    process.exit(1)
  })
}

// Test seam (vitest imports this module; the CLI guard above keeps main()
// from running under test).
export {
  buildCloseMarket,
  buildResolveMarket,
  decodeMarketPools,
  instructionDiscriminator,
  modelOddsOf,
  planBoostDepths,
  readEstimate,
  resolveDraw,
  validateRaw,
  RESOLUTION_DECISIONS,
}
export function __useProgramIdForTests(publicKey) {
  PROGRAM_ID = publicKey
}
