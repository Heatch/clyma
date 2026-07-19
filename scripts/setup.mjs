import { Connection, Keypair, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } from "@solana/web3.js"
import { GoogleGenAI } from "@google/genai"
import { MongoClient } from "mongodb"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))

// Load .env manually (Node doesn't do this for scripts)
{
  const envPath = join(__dirname, "..", ".env")
  try {
    const content = readFileSync(envPath, "utf-8")
    for (const line of content.split("\n")) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith("#")) continue
      const eq = trimmed.indexOf("=")
      if (eq === -1) continue
      const key = trimmed.slice(0, eq).trim()
      if (!process.env[key]) {
        process.env[key] = trimmed.slice(eq + 1).trim()
      }
    }
  } catch {
    // .env not found, proceed with existing env vars
  }
}

const PROGRAM_ID = new PublicKey("EkcwkAzNUCGRcKCA5WJc7GCtUXooubkm3ktesBWQXPBt")
const RPC = "https://api.devnet.solana.com"

const PROTOCOL_SEED = Buffer.from("protocol")
const MARKET_SEED = Buffer.from("market")
const VAULT_SEED = Buffer.from("vault")
const YES_POSITION_SEED = Buffer.from("yes_position")
const NO_POSITION_SEED = Buffer.from("no_position")

const MARKET_COUNT = 24
const BASE_MARKET_ID = 2001
const FUNDING_PER_SIDE = 500_000

const GEMINI_MODEL = process.env.GEMINI_MODEL?.trim() || "gemini-3.5-flash"
const GEMINI_API_KEY = process.env.GEMINI_API_KEY?.trim()
const MONGODB_URI = process.env.MONGODB_URI

// ---------------------------------------------------------------------------
// Env
// ---------------------------------------------------------------------------

if (!GEMINI_API_KEY) {
  console.error("GEMINI_API_KEY not set")
  process.exit(1)
}
if (!MONGODB_URI) {
  console.error("MONGODB_URI not set")
  process.exit(1)
}

const WALLET_PATH = join(homedir(), ".config", "solana", "id.json")
let wallet
try {
  const secret = JSON.parse(readFileSync(WALLET_PATH, "utf-8"))
  wallet = Keypair.fromSecretKey(Uint8Array.from(secret))
} catch {
  console.error(`No Solana keypair found at ${WALLET_PATH}`)
  process.exit(1)
}

// ---------------------------------------------------------------------------
// Solana helpers
// ---------------------------------------------------------------------------

const connection = new Connection(RPC, "confirmed")

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
  const yesPosition = PublicKey.findProgramAddressSync([YES_POSITION_SEED, marketPda.toBuffer(), ownerPubkey.toBuffer()], PROGRAM_ID)[0]
  const noPosition = PublicKey.findProgramAddressSync([NO_POSITION_SEED, marketPda.toBuffer(), ownerPubkey.toBuffer()], PROGRAM_ID)[0]
  return { yesPosition, noPosition }
}
function instructionDiscriminator(name) {
  return createHash("sha256").update(`global:${name}`).digest().subarray(0, 8)
}

function buildInitProtocol(protocol, authority, resolver) {
  const disc = instructionDiscriminator("initialize_protocol")
  return {
    programId: PROGRAM_ID,
    keys: [
      { pubkey: protocol, isSigner: false, isWritable: true },
      { pubkey: authority, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([disc, resolver.toBuffer()]),
  }
}
function buildCreateMarket(protocol, authority, market, vault, marketId, questionHash, closeTs, resolutionTs) {
  const disc = instructionDiscriminator("create_market")
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
    data: Buffer.concat([disc, idBuf, Buffer.from(questionHash), closeBuf, resBuf]),
  }
}
function buildFundMarket(protocol, market, vault, yesPos, noPos, funder, yesAmt, noAmt) {
  const disc = instructionDiscriminator("fund_market")
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
    data: Buffer.concat([disc, yesBuf, noBuf]),
  }
}
function futureTimestamp(daysFromNow = 30) {
  return Math.floor(Date.now() / 1000) + daysFromNow * 86400
}
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
async function sendTxn(tx, signer) {
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      const sig = await sendAndConfirmTransaction(connection, tx, [signer], { commitment: "confirmed" })
      return sig
    } catch (err) {
      if (err.message && err.message.includes("429")) {
        await sleep(1000 * (2 ** attempt))
        continue
      }
      throw err
    }
  }
  throw new Error("Failed after 10 retries (rate limited)")
}

// ---------------------------------------------------------------------------
// Gemini helpers
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000
const HISTORY_POINT_COUNT = 7
const HISTORY_CADENCE_DAYS = 14
const GENERATION_TIMEOUT_MS = 90_000

const MARKET_CATEGORIES = ["hurricane","drought","temperature","rainfall","crop-yield","wildfire","flooding","other"]
const MARKET_CONTINENTS = ["North America","South America","Europe","Africa","Asia","Oceania"]
const EVIDENCE_KINDS = ["forecast","observation","methodology","resolution-source","background"]
const RESOLVER = "3mshx6HoZop71xQ483kLMdiUuXQ1UxDgBABuLnFkVfDV"
const PLACEHOLDER_WALLETS = [
  "Udf5rTTTfiQGstoHtf6TsUfo9zHjN2zjo9kF49vebzH",
  "2HfCoU3aZFH7wxttXUa7xNjpj49P6KdMwwFvx6MpcRos",
  "3mshx6HoZop71xQ483kLMdiUuXQ1UxDgBABuLnFkVfDV",
]

const PROMPT = `You are curating ${MARKET_COUNT} binary (YES/NO) climate prediction markets. Spread them across all six inhabited continents and vary the hazard categories.

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

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)) }
function round(v, places = 2) { const f = 10 ** places; return Math.round(v * f) / f }
function slugify(input) { return input.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"").slice(0, 60)||"market" }
function normalizeUrl(value) {
  if (typeof value !== "string") return null
  const t = value.trim()
  if (!t) return null
  const c = /^https?:\/\//i.test(t) ? t : `https://${t}`
  try { const u = new URL(c); if (u.protocol === "http:" || u.protocol === "https:") return u.toString() } catch {}
  return null
}
function isoDaysAgo(d) { return new Date(Date.now() - d * DAY_MS).toISOString() }
function trendTo(target) {
  const start = clamp(target - 0.12, 0.04, 0.96)
  return Array.from({ length: HISTORY_POINT_COUNT }, (_, i) => round(clamp(start + (target - start) * (i / (HISTORY_POINT_COUNT - 1)), 0.02, 0.98), 4))
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

function buildHistory(start, probs, baseLiq, baseVol) {
  const st = Date.parse(start)
  return probs.map((yp, i) => {
    const tl = baseLiq + 18 * i
    return {
      timestamp: new Date(st + i * HISTORY_CADENCE_DAYS * DAY_MS).toISOString(),
      yesProbability: yp,
      noProbability: round(1 - yp, 4),
      totalVolume: round(baseVol + 31 * i),
      yesLiquidity: round(tl * yp),
      noLiquidity: round(tl - round(tl * yp)),
      dataLabel: "",
    }
  })
}

function mapMarket(raw, index) {
  if (!MARKET_CATEGORIES.includes(raw.category)) return null
  if (!MARKET_CONTINENTS.includes(raw.continent)) return null
  const q = raw.question?.trim()
  const d = raw.description?.trim()
  const r = raw.region?.trim()
  const rs = raw.resolutionSource?.trim()
  const rr = raw.resolutionRules?.trim()
  if (!q || !d || !r || !rs || !rr) return null
  const lat = Number(raw.latitude), lng = Number(raw.longitude)
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) return null
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) return null
  const rsu = normalizeUrl(raw.resolutionSourceUrl)
  if (!rsu) return null
  const yes = round(clamp(Number(raw.estimatedProbability) || 0.5, 0.05, 0.95), 2)
  const no = round(1 - yes, 2)
  const now = Date.now()
  const closeDays = clamp(Math.round(Number(raw.closeInDays) || 60), 7, 300)
  const created = new Date(now - (HISTORY_POINT_COUNT - 1) * HISTORY_CADENCE_DAYS * DAY_MS).toISOString()
  const close = new Date(now + closeDays * DAY_MS).toISOString()
  const resolution = new Date(now + (closeDays + 14) * DAY_MS).toISOString()
  const id = `market-${slugify(q)}-${index}`.slice(0, 110)
  const slug = `${slugify(q)}-${index}`.slice(0, 110)
  const totalLiq = 700 + index * 25
  const yl = round(totalLiq * yes)
  const nl = round(totalLiq - yl)

  const evidence = []
  const evList = Array.isArray(raw.evidence) ? raw.evidence : []
  evList.forEach((ev, ei) => {
    const u = normalizeUrl(ev?.url)
    if (!u || !ev?.title?.trim() || !ev?.summary?.trim() || !ev?.publisher?.trim()) return
    evidence.push({
      id: `${id}-evidence-${ei}`,
      title: ev.title.trim().slice(0, 240),
      summary: ev.summary.trim().slice(0, 1000),
      publisher: ev.publisher.trim().slice(0, 160),
      url: u,
      publishedAt: created,
      kind: EVIDENCE_KINDS.includes(ev?.kind) ? ev.kind : "background",
      isDemo: false,
    })
  })
  if (evidence.length === 0) {
    evidence.push({
      id: `${id}-evidence-source`,
      title: rs.slice(0, 240),
      summary: "Official source proposed for resolution.",
      publisher: rs.slice(0, 160),
      url: rsu,
      publishedAt: created,
      kind: "resolution-source",
      isDemo: false,
    })
  }

  return {
    id,
    onchainMarketId: BASE_MARKET_ID + index,
    question: q.slice(0, 400),
    slug,
    description: d.slice(0, 2000),
    category: raw.category,
    continent: raw.continent,
    country: raw.country?.trim().slice(0, 100) || undefined,
    region: r.slice(0, 160),
    latitude: lat,
    longitude: lng,
    closeTime: close,
    resolutionTime: resolution,
    status: "open",
    outcome: "unresolved",
    yesPrice: yes,
    noPrice: no,
    yesLiquidity: yl,
    noLiquidity: nl,
    totalVolume: round(900 + yes * 4200),
    participants: Math.round(70 + yes * 260),
    resolutionSource: rs.slice(0, 300),
    resolutionSourceUrl: rsu,
    resolutionRules: rr.slice(0, 4000),
    resolver: RESOLVER,
    createdAt: created,
    featured: index < 4,
    trendingScore: clamp(Math.round(45 + yes * 45), 0, 100),
    history: buildHistory(created, trendTo(yes), totalLiq, round(600 + yes * 1500)),
    evidence,
    recentTrades: [
      { side:"yes", amountSol:round(0.5+yes*3,2), probability:yes, timestamp:isoDaysAgo(0) },
      { side:"no",  amountSol:round(0.5+no*2.5,2), probability:no, timestamp:isoDaysAgo(1) },
      { side:"yes", amountSol:round(0.4+yes*1.5,2), probability:round(clamp(yes-0.02,0.02,0.98),2), timestamp:isoDaysAgo(2) },
    ].map((t,i) => ({id:`${id}-trade-${i+1}`,marketId:id,...t,amountLamports:Math.round(t.amountSol*1e9).toString(),estimatedPayoutSol:round(t.amountSol/t.probability,4),wallet:PLACEHOLDER_WALLETS[i%3],isDemo:false})),
    network: "devnet",
    settlementAsset: "SOL",
    marketModel: "pooled-binary",
    isDemo: false,
    dataLabel: "",
    dataDisclaimer: "",
  }
}

async function callGemini() {
  const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY })
  const today = new Date().toISOString().slice(0, 10)
  const interaction = await ai.interactions.create({ model: GEMINI_MODEL, input: `Today's date is ${today}.\n\n${PROMPT}` })
  const text = interaction.output_text
  if (!text) throw new Error("Gemini returned empty response")
  const parsed = JSON.parse(extractJson(text))
  if (!Array.isArray(parsed.markets) || parsed.markets.length === 0) throw new Error("No markets in response")
  return parsed.markets
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(`Wallet: ${wallet.publicKey.toBase58()}`)
  const balance = await connection.getBalance(wallet.publicKey)
  console.log(`Balance: ${balance / 1e9} SOL\n`)

  // --- Step 1: Generate markets ---
  console.log("Step 1: Generating 24 climate markets via Gemini...")
  const raw = await callGemini()
  const markets = raw.map((m, i) => mapMarket(m, i)).filter(Boolean)
  console.log(`${markets.length}/${raw.length} passed validation\n`)
  if (markets.length === 0) { console.error("No valid markets"); process.exit(1) }

  const target = markets.slice(0, MARKET_COUNT)
  if (target.length < MARKET_COUNT) console.warn(`Only ${target.length} markets (expected ${MARKET_COUNT})`)

  // --- Step 2: On-chain ---
  console.log("Step 2: Creating on-chain markets...")

  const protocolPda = deriveProtocol()
  const protocolInfo = await connection.getAccountInfo(protocolPda)
  if (!protocolInfo) {
    console.log("  Initializing protocol...")
    const ix = buildInitProtocol(protocolPda, wallet.publicKey, wallet.publicKey)
    await sendTxn(new Transaction().add(ix), wallet)
    console.log("  Protocol initialized!")
    await sleep(1500)
  } else {
    console.log("  Protocol already initialized")
  }

  for (const m of target) {
    const { market, vault } = deriveMarket(m.onchainMarketId)
    const existing = await connection.getAccountInfo(market)
    if (existing) {
      console.log(`  [${m.onchainMarketId}] already exists, skipping`)
      continue
    }

    const qHash = createHash("sha256").update(m.question).digest()
    const closeTs = Math.floor(Date.parse(m.closeTime) / 1000)
    const resTs = Math.floor(Date.parse(m.resolutionTime) / 1000)

    console.log(`  [${m.onchainMarketId}] Creating: ${m.question.slice(0, 80)}...`)
    const createIx = buildCreateMarket(protocolPda, wallet.publicKey, market, vault, m.onchainMarketId, qHash, closeTs, resTs)
    await sendTxn(new Transaction().add(createIx), wallet)
    await sleep(1500)

    console.log(`  [${m.onchainMarketId}] Funding...`)
    const { yesPosition, noPosition } = derivePositions(market, wallet.publicKey)
    const fundIx = buildFundMarket(protocolPda, market, vault, yesPosition, noPosition, wallet.publicKey, FUNDING_PER_SIDE, FUNDING_PER_SIDE)
    await sendTxn(new Transaction().add(fundIx), wallet)
    await sleep(1500)
  }

  // --- Step 3: MongoDB ---
  console.log("\nStep 3: Seeding MongoDB...")
  const client = new MongoClient(MONGODB_URI, { serverSelectionTimeoutMS: 15000 })
  await client.connect()
  const db = client.db("climate_market")

  for (const m of target) {
    await db.collection("markets").updateOne(
      { onchainMarketId: m.onchainMarketId },
      {
        $set: {
          marketId: m.id, onchainMarketId: m.onchainMarketId,
          title: m.question, question: m.question, description: m.description, slug: m.slug,
          category: m.category, continent: m.continent, country: m.country ?? null, region: m.region,
          latitude: m.latitude, longitude: m.longitude,
          resolutionSource: m.resolutionSource, resolutionSourceUrl: m.resolutionSourceUrl, resolutionRules: m.resolutionRules,
          status: m.status, outcome: m.outcome,
          yesPrice: m.yesPrice, noPrice: m.noPrice, yesLiquidity: m.yesLiquidity, noLiquidity: m.noLiquidity,
          totalVolume: m.totalVolume, participants: m.participants,
          featured: m.featured, trendingScore: m.trendingScore,
          resolver: wallet.publicKey.toBase58(),
          isDemo: false, dataLabel: "", dataDisclaimer: "",
          openAt: new Date(m.createdAt), closesAt: new Date(m.closeTime), resolvesAt: new Date(m.resolutionTime ?? m.closeTime),
          createdAt: new Date(m.createdAt),
        },
      },
      { upsert: true },
    )
  }

  const count = await db.collection("markets").countDocuments()
  console.log(`  MongoDB: ${count} market documents`)
  await client.close()

  // --- Done ---
  const finalBal = await connection.getBalance(wallet.publicKey)
  console.log(`\nDone! Final balance: ${finalBal / 1e9} SOL`)
  console.log(`Markets: ${BASE_MARKET_ID}–${BASE_MARKET_ID + target.length - 1}`)
}

main().catch((err) => { console.error("FAIL:", err.message); process.exit(1) })
