// scripts/lifecycle.mjs — market lifecycle operations.
//
// Currently implements `seed`; `close` / `resolve` / `roll` arrive in Batch 5.
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

import { GoogleGenAI } from "@google/genai"
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js"
import { MongoClient } from "mongodb"
import { createHash } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { readFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { loadEnv, requireProgramId, resolveRpcUrl } from "./lib/env.mjs"
import { buildTape, LAMPORTS_PER_SOL } from "./lib/tape.mjs"

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
    }
    else if (a === "--base-id") args.baseId = Number(argv[++i])
    else if (a === "--fixture-file") args.fixtureFile = argv[++i]
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
  "hurricane", "drought", "temperature", "rainfall",
  "crop-yield", "wildfire", "flooding", "other",
]
const MARKET_CONTINENTS = [
  "North America", "South America", "Europe", "Africa", "Asia", "Oceania",
]
const EVIDENCE_KINDS = [
  "forecast", "observation", "methodology", "resolution-source", "background",
]

const GEMINI_MODEL = process.env.GEMINI_MODEL?.trim() || "gemini-3.5-flash"

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
- estimatedProbability: number 0-1
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
    input.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) ||
    "market"
  )
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

async function callGemini(count, apiKey) {
  const ai = new GoogleGenAI({ apiKey })
  const today = new Date().toISOString().slice(0, 10)
  const request = ai.interactions.create({
    model: GEMINI_MODEL,
    input: `Today's date is ${today}.\n\n${promptFor(count)}`,
  })
  const interaction = await Promise.race([
    request,
    new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error(`Generation timed out after ${GENERATION_TIMEOUT_MS}ms`)),
        GENERATION_TIMEOUT_MS,
      ),
    ),
  ])
  const text = interaction.output_text
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
  if (!question || !description || !region || !resolutionSource || !resolutionRules) {
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
  const targetYes = clamp(Number(raw.estimatedProbability) || 0.5, 0.05, 0.95)
  const closeDays = clamp(Math.round(Number(raw.closeInDays) || 60), 7, 300)
  const evidence = []
  const list = Array.isArray(raw.evidence) ? raw.evidence : []
  for (const ev of list) {
    const url = normalizeUrl(ev?.url)
    if (!url || !ev?.title?.trim() || !ev?.summary?.trim() || !ev?.publisher?.trim()) {
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

async function loadDefinitions(args, apiKey) {
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

  if (!apiKey) {
    throw new Error(
      "GEMINI_API_KEY is not set and no --fixture-file given. Generate once with quota, then replay offline via --fixture-file.",
    )
  }
  const valid = []
  const seen = new Set()
  const batchMax = clamp(Math.round(args.batchSize || 25), 1, GENERATION_BATCH_MAX)
  for (let round = 0; valid.length < args.markets && round < 6; round++) {
    const need = Math.min(batchMax, args.markets - valid.length)
    console.log(
      `Generating ${need} market definitions via model (round ${round + 1})...`,
    )
    let raw
    try {
      raw = await callGemini(need, apiKey)
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

function assembleMarket(def, globalIndex, onchainMarketId, depthSol, resolver, now) {
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
  const resolutionTime = new Date(now + (def.closeDays + 14) * DAY_MS).toISOString()
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
// Solana builders (ported from setup.mjs; discriminator layout unchanged)
// ---------------------------------------------------------------------------

let PROGRAM_ID
let connection

function deriveProtocol() {
  return PublicKey.findProgramAddressSync([PROTOCOL_SEED], PROGRAM_ID)[0]
}
function deriveMarket(marketId) {
  const idBuf = Buffer.alloc(8)
  idBuf.writeBigUInt64LE(BigInt(marketId))
  const market = PublicKey.findProgramAddressSync([MARKET_SEED, idBuf], PROGRAM_ID)[0]
  const vault = PublicKey.findProgramAddressSync([VAULT_SEED, market.toBuffer()], PROGRAM_ID)[0]
  return { market, vault }
}
function derivePositions(marketPda, ownerPubkey) {
  const yesPosition = PublicKey.findProgramAddressSync(
    [YES_POSITION_SEED, marketPda.toBuffer(), ownerPubkey.toBuffer()], PROGRAM_ID,
  )[0]
  const noPosition = PublicKey.findProgramAddressSync(
    [NO_POSITION_SEED, marketPda.toBuffer(), ownerPubkey.toBuffer()], PROGRAM_ID,
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
    data: Buffer.concat([instructionDiscriminator("initialize_protocol"), resolver.toBuffer()]),
  }
}
function buildCreateMarket(protocol, authority, market, vault, marketId, questionHash, closeTs, resolutionTs) {
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
      instructionDiscriminator("create_market"), idBuf, Buffer.from(questionHash), closeBuf, resBuf,
    ]),
  }
}
function buildFundMarket(protocol, market, vault, yesPos, noPos, funder, yesAmt, noAmt) {
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
    data: Buffer.concat([instructionDiscriminator("fund_market"), yesBuf, noBuf]),
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

async function connectDb(mongoUri) {
  const client = new MongoClient(mongoUri, { serverSelectionTimeoutMS: 15000 })
  await client.connect()
  return { client, db: client.db("climate_market") }
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
  const fundingTotal = markets.reduce((a, m) => a + m.tape.pools.totalLamports, 0)
  return { markets, fundingTotal }
}

/**
 * Exact pre-write budget: pool funding + rent for not-yet-created PDAs +
 * protocol rent when uninitialized + fee buffer. Read-only.
 */
async function checkBudget(markets, fundingTotal) {
  const addresses = markets.map((m) => deriveMarket(m.doc.onchainMarketId).market)
  const infos = []
  for (let i = 0; i < addresses.length; i += 100) {
    infos.push(...(await connection.getMultipleAccountsInfo(addresses.slice(i, i + 100))))
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
    rentTotal += await connection.getMinimumBalanceForRentExemption(PROTOCOL_SPACE)
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
 * Fund on-chain pools + index to MongoDB. Shared by `seed` and `roll` top-up.
 */
async function fundAndIndex(markets, { wallet, mongoUri, reset }) {
  if (wallet) {
    const protocolPda = deriveProtocol()
    if (!(await connection.getAccountInfo(protocolPda))) {
      console.log("Initializing protocol...")
      await sendTxn(
        new Transaction().add(buildInitProtocol(protocolPda, wallet.publicKey, wallet.publicKey)),
        wallet,
      )
      await sleep(1500)
    } else {
      console.log("Protocol already initialized")
    }
    for (const m of markets) {
      const { market, vault } = deriveMarket(m.doc.onchainMarketId)
      if (await connection.getAccountInfo(market)) {
        console.log(`  [${m.doc.onchainMarketId}] already exists, skipping`)
        continue
      }
      const qHash = createHash("sha256").update(m.doc.question).digest()
      const closeTs = Math.floor(Date.parse(m.doc.closeTime) / 1000)
      const resTs = Math.floor(Date.parse(m.doc.resolutionTime) / 1000)
      console.log(`  [${m.doc.onchainMarketId}] creating: ${m.doc.question.slice(0, 70)}...`)
      await sendTxn(
        new Transaction().add(
          buildCreateMarket(protocolPda, wallet.publicKey, market, vault, m.doc.onchainMarketId, qHash, closeTs, resTs),
        ),
        wallet,
      )
      await sleep(1500)
      const { yesPosition, noPosition } = derivePositions(market, wallet.publicKey)
      console.log(
        `  [${m.doc.onchainMarketId}] funding ${(m.tape.pools.yesLamports / LAMPORTS_PER_SOL).toFixed(4)} / ` +
          `${(m.tape.pools.noLamports / LAMPORTS_PER_SOL).toFixed(4)} SOL`,
      )
      await sendTxn(
        new Transaction().add(
          buildFundMarket(
            protocolPda, market, vault, yesPosition, noPosition, wallet.publicKey,
            m.tape.pools.yesLamports, m.tape.pools.noLamports,
          ),
        ),
        wallet,
      )
      await sleep(1500)
    }
  }

  if (mongoUri) {
    console.log("Indexing to MongoDB...")
    const { client, db } = await connectDb(mongoUri)
    if (reset) {
      for (const name of ["markets", "positions", "transactions", "market_prices", "resolutions"]) {
        await db.collection(name).drop().catch(() => {})
      }
      await db.collection("markets").createIndex({ status: 1 })
      await db.collection("markets").createIndex({ category: 1 })
      await db.collection("markets").createIndex({ closesAt: 1 })
      await db
        .collection("markets")
        .createIndex({ onchainMarketId: 1 }, { unique: true, sparse: true })
      await db.collection("market_prices").createIndex({ marketId: 1, timestamp: 1 })
      console.log("  Reset: dropped market collections, recreated indexes")
    }
    for (const m of markets) {
      const d = m.doc
      await db.collection("markets").updateOne(
        { onchainMarketId: d.onchainMarketId },
        {
          $set: {
            marketId: d.id, onchainMarketId: d.onchainMarketId,
            title: d.question, question: d.question, description: d.description, slug: d.slug,
            category: d.category, continent: d.continent, country: d.country ?? null, region: d.region,
            latitude: d.latitude, longitude: d.longitude,
            resolutionSource: d.resolutionSource, resolutionSourceUrl: d.resolutionSourceUrl,
            resolutionRules: d.resolutionRules,
            status: d.status, outcome: d.outcome,
            yesPrice: d.yesPrice, noPrice: d.noPrice,
            yesLiquidity: d.yesLiquidity, noLiquidity: d.noLiquidity,
            totalVolume: d.totalVolume, participants: d.participants,
            featured: d.featured, trendingScore: d.trendingScore,
            resolver: d.resolver,
            history: d.history, evidence: d.evidence, recentTrades: d.recentTrades,
            participantWallets: [...new Set(m.tape.trades.map((t) => t.wallet))],
            openAt: new Date(d.createdAt), closesAt: new Date(d.closeTime),
            resolvesAt: new Date(d.resolutionTime),
            createdAt: new Date(d.createdAt),
          },
        },
        { upsert: true },
      )
      const doc = await db
        .collection("markets")
        .findOne({ onchainMarketId: d.onchainMarketId }, { projection: { _id: 1 } })
      if (doc) {
        await db.collection("market_prices").deleteMany({
          marketId: doc._id, triggerEvent: "creation",
        })
        await db.collection("market_prices").insertMany(
          d.history.map((p) => ({
            marketId: doc._id,
            timestamp: new Date(p.timestamp),
            yesPrice: p.yesProbability,
            noPrice: p.noProbability,
            volume: p.totalVolume,
            triggerEvent: "creation",
          })),
        )
      }
    }
    const countDocs = await db.collection("markets").countDocuments()
    console.log(`  MongoDB: ${countDocs} market documents`)
    await client.close()
  }
}

/**
 * Close every open market past its close time (on-chain + DB).
 * With dry=true, only lists what would close.
 * Returns { closed, failed }.
 */
async function closeDueMarkets(db, wallet, dry = false) {
  const now = new Date()
  const due = await db
    .collection("markets")
    .find({ status: "open", closesAt: { $lte: now } })
    .project({ marketId: 1, onchainMarketId: 1, question: 1 })
    .toArray()
  if (dry) {
    for (const doc of due) {
      console.log(`  would close ${doc.onchainMarketId}: ${doc.question?.slice(0, 60)}...`)
    }
    return { closed: [], failed: [] }
  }
  const closed = []
  const failed = []
  for (const doc of due) {
    const { market } = deriveMarket(doc.onchainMarketId)
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
      await db
        .collection("markets")
        .updateOne({ _id: doc._id }, { $set: { status: "closed" } })
      closed.push(doc.marketId)
      console.log(`  closed ${doc.onchainMarketId}: ${doc.question?.slice(0, 60)}...`)
    } catch (err) {
      failed.push(doc.marketId)
      console.error(`  CLOSE FAILED ${doc.onchainMarketId}: ${err.message}`)
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
async function resolveDueMarkets(db, wallet, dry = false) {
  const now = new Date()
  const due = await db
    .collection("markets")
    .find({ status: "closed", resolvesAt: { $lte: now } })
    .toArray()
  if (dry) {
    for (const doc of due) {
      const outcome = resolveDraw(doc.marketId, modelOddsOf(doc))
      console.log(`  would resolve ${doc.onchainMarketId} -> ${outcome.toUpperCase()}`)
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
      await db.collection("markets").updateOne(
        { _id: doc._id },
        { $set: { status: "resolved", outcome } },
      )
      await db.collection("resolutions").insertOne({
        marketId: doc._id,
        marketDocId: doc.marketId,
        dataSource: "lifecycle-seed-draw",
        resolvedOutcome: outcome,
        resolverType: "automated",
        resolverWallet: wallet ? wallet.publicKey.toBase58() : "lifecycle",
        proofUrl: signature
          ? `https://explorer.solana.com/tx/${signature}?cluster=devnet`
          : undefined,
        resolvedAt: new Date(),
      })
      const won = await db.collection("positions").updateMany(
        { marketDocId: doc.marketId, status: "open", side: outcome },
        { $set: { status: "won", settledAt: new Date() } },
      )
      const lost = await db.collection("positions").updateMany(
        {
          marketDocId: doc.marketId,
          status: "open",
          side: outcome === "yes" ? "no" : "yes",
        },
        { $set: { status: "lost", settledAt: new Date() } },
      )
      if (signature) {
        await db.collection("transactions").insertOne({
          walletAddress: wallet.publicKey.toBase58(),
          type: "market_resolved",
          chain: "solana",
          token: "SOL",
          txSignature: signature,
          status: "confirmed",
          marketDocId: doc.marketId,
          onchainMarketId: doc.onchainMarketId,
          createdAt: new Date(),
          confirmedAt: new Date(),
        })
      }
      resolved.push(doc.marketId)
      console.log(
        `  resolved ${doc.onchainMarketId} -> ${outcome.toUpperCase()} ` +
          `(winners: ${won.modifiedCount}, losers: ${lost.modifiedCount})`,
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

  const apiKey = process.env.GEMINI_API_KEY?.trim()
  const mongoUri = process.env.MONGODB_URI
  if (!args.skipDb && !mongoUri) {
    console.error("MONGODB_URI is not set (or pass --skip-db)")
    process.exit(1)
  }

  const wallet = loadWallet(!args.skipChain)

  // --- Phase 1: definitions ---
  const defs = await loadDefinitions(args, apiKey)
  const count = args.fixtureFile ? defs.length : Math.min(defs.length, args.markets)
  const chosen = defs.slice(0, count)

  // Save validated definitions for offline replay.
  const defsDir = join(tmpdir(), "clyma")
  await mkdir(defsDir, { recursive: true })
  const defsPath = join(defsDir, `seed-definitions-${Date.now()}.json`)
  await writeFile(defsPath, JSON.stringify({ markets: chosen }, null, 2), "utf-8")
  console.log(`Definitions saved to ${defsPath} (replay with --fixture-file)`)

  // --- Phase 2: tapes + assembly ---
  const now = Date.now()
  const { markets, fundingTotal } = assembleAll(chosen, {
    baseId: args.baseId,
    budgetTotal: args.budget,
    resolver: wallet ? wallet.publicKey.toBase58() : "11111111111111111111111111111111",
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

  await fundAndIndex(markets, { wallet, mongoUri, reset: args.reset })

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

  const mongoUri = process.env.MONGODB_URI
  if (!mongoUri) {
    console.error("MONGODB_URI is not set")
    process.exit(1)
  }
  const wallet = loadWallet(true)
  const { client, db } = await connectDb(mongoUri)
  const { closed, failed } = await closeDueMarkets(db, wallet, args.dryRun)
  await client.close()
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

  const mongoUri = process.env.MONGODB_URI
  if (!mongoUri) {
    console.error("MONGODB_URI is not set")
    process.exit(1)
  }
  const wallet = loadWallet(true)
  const { client, db } = await connectDb(mongoUri)
  const { resolved, failed } = await resolveDueMarkets(db, wallet, args.dryRun)
  await client.close()
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
  const apiKey = process.env.GEMINI_API_KEY?.trim()
  const mongoUri = process.env.MONGODB_URI
  if (!mongoUri) {
    console.error("MONGODB_URI is not set")
    process.exit(1)
  }
  const wallet = loadWallet(true)

  const { client, db } = await connectDb(mongoUri)

  console.log("Step 1: closing expired markets...")
  const closed = await closeDueMarkets(db, wallet, args.dryRun)
  console.log("Step 2: resolving due markets...")
  const resolved = await resolveDueMarkets(db, wallet, args.dryRun)

  const openCount = await db.collection("markets").countDocuments({ status: "open" })
  const needed = target - openCount
  console.log(`Open markets: ${openCount}, target: ${target}, needed: ${Math.max(0, needed)}`)
  if (needed <= 0) {
    console.log("Nothing to top up.")
    await client.close()
    return
  }

  console.log(`Step 3: topping up ${needed} markets...`)
  const defs = await loadDefinitions({ ...args, markets: needed }, apiKey)
  const chosen = defs.slice(0, needed)
  if (chosen.length < needed) {
    console.warn(`Only ${chosen.length} definitions for ${needed} needed — proceeding`)
  }
  if (chosen.length === 0) {
    console.error("No definitions to top up with")
    await client.close()
    process.exit(1)
  }

  const maxDoc = await db
    .collection("markets")
    .find({})
    .sort({ onchainMarketId: -1 })
    .limit(1)
    .project({ onchainMarketId: 1 })
    .toArray()
  const baseId = (maxDoc[0]?.onchainMarketId ?? args.baseId - 1) + 1
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
    await client.close()
    return
  }
  const budget = await checkBudget(markets, fundingTotal)
  const needLamports = printBudget(budget)
  await requireFunds(wallet, needLamports, args.force)
  await client.close()

  await fundAndIndex(markets, { wallet, mongoUri, reset: false })

  console.log(
    `\nRoll done! closed=${closed.closed.length} resolved=${resolved.resolved.length} ` +
      `topped-up=${markets.length} (IDs ${baseId}–${baseId + markets.length - 1})`,
  )
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
    if (args.budgetExplicit && (!Number.isFinite(args.budget) || args.budget <= 0)) {
      console.error("--budget must be a positive number")
      process.exit(1)
    }
    await rollCommand(args)
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
  instructionDiscriminator,
  modelOddsOf,
  resolveDraw,
  RESOLUTION_DECISIONS,
}
export function __useProgramIdForTests(publicKey) {
  PROGRAM_ID = publicKey
}
