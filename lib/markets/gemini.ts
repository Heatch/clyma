import { mkdir, readFile, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { GoogleGenAI } from "@google/genai"

import {
  DEMO_DATA_DISCLAIMER,
  DEMO_WALLETS,
  buildHistory,
  buildTrades,
  demoMarkets,
} from "./data"
import {
  MARKET_CATEGORIES,
  MARKET_CONTINENTS,
  type ClimateMarket,
  type MarketCategory,
  type MarketContinent,
  type MarketEvidence,
} from "./types"
import { climateMarketSchema } from "../validation/marketSchemas"

const API_KEY = process.env.GEMINI_API_KEY?.trim()
// The Interactions API (unlike generateContent) has working free-tier quota on
// current AI Studio "AQ." keys, so the app generates through it.
const MODEL = process.env.GEMINI_MODEL?.trim() || "gemini-3.5-flash"
const parsedCount = Number.parseInt(process.env.GEMINI_MARKET_COUNT ?? "", 10)
const MARKET_COUNT =
  Number.isFinite(parsedCount) && parsedCount > 0
    ? Math.min(parsedCount, 50)
    : 34
const DAY_MS = 86_400_000
const GENERATION_TIMEOUT_MS = 90_000
const CACHE_TTL_MS = 24 * 60 * 60 * 1000
const FAILURE_BACKOFF_MS = 5 * 60 * 1000
const CACHE_DIR = path.join(os.tmpdir(), "klashi-climate")
const CACHE_FILE = path.join(CACHE_DIR, "gemini-markets.json")

const EVIDENCE_KINDS = [
  "forecast",
  "observation",
  "methodology",
  "resolution-source",
  "background",
] as const

export type MarketSource = "gemini" | "sample"

export interface MarketGenerationResult {
  markets: ClimateMarket[]
  source: MarketSource
  error?: string
}

interface GeminiEvidence {
  title?: string
  summary?: string
  publisher?: string
  url?: string
  kind?: string
}

interface GeminiMarket {
  question?: string
  category?: string
  continent?: string
  country?: string
  region?: string
  latitude?: number
  longitude?: number
  closeInDays?: number
  estimatedProbability?: number
  resolutionSource?: string
  resolutionSourceUrl?: string
  resolutionRules?: string
  description?: string
  evidence?: GeminiEvidence[]
}

interface CacheShape {
  generatedAt: number
  model: string
  count: number
  markets: ClimateMarket[]
}

const PROMPT = `You are curating ${MARKET_COUNT} binary (YES/NO) climate prediction markets for a demonstration app. Spread them across all six inhabited continents and vary the hazard categories.

Every question must resolve in the FUTURE relative to the provided current date. Do not reference past years or already-completed seasons or events.

Return ONLY a JSON object of the form {"markets": [ ... ]} with no markdown fences and no prose. Each item in "markets" must have exactly these fields:
- question: string. A specific, objectively resolvable YES/NO question about a future climate or weather event, resolving within the next 30-240 days.
- category: one of ${JSON.stringify(MARKET_CATEGORIES)}.
- continent: one of ${JSON.stringify(MARKET_CONTINENTS)}.
- country: string. A real country (or omit if not applicable).
- region: string. A real place within that continent.
- latitude: number. Accurate latitude for the region.
- longitude: number. Accurate longitude for the region.
- closeInDays: integer between 30 and 240.
- estimatedProbability: number between 0 and 1, your rough probability the event resolves YES.
- resolutionSource: string. A REAL, reputable authority (e.g. NOAA, NASA, WMO, national meteorological/hydrological agencies, Copernicus, USGS).
- resolutionSourceUrl: string. That source's real official URL.
- resolutionRules: string. Precise, objective settlement criteria referencing the source.
- description: string. One or two neutral sentences.
- evidence: array of 2-3 objects, each { "title": string, "summary": string, "publisher": string, "url": string (a real official URL), "kind": one of ${JSON.stringify(EVIDENCE_KINDS)} }. Only cite well-known official sources; never invent domains or URLs.`

let memoryCache: ClimateMarket[] | null = null
let inFlight: Promise<ClimateMarket[]> | null = null
let failedUntil = 0

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function round(value: number, places = 2): number {
  const factor = 10 ** places
  return Math.round(value * factor) / factor
}

function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "market"
  )
}

function normalizeUrl(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  if (!trimmed) return null
  const candidate = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`
  try {
    const url = new URL(candidate)
    if (url.protocol !== "http:" && url.protocol !== "https:") return null
    return url.toString()
  } catch {
    return null
  }
}

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * DAY_MS).toISOString()
}

function trendTo(target: number): number[] {
  const start = clamp(target - 0.12, 0.04, 0.96)
  const points = 7
  return Array.from({ length: points }, (_, index) =>
    round(
      clamp(start + (target - start) * (index / (points - 1)), 0.02, 0.98),
      4,
    ),
  )
}

/** Pulls a JSON object out of a model response that may be fenced or prefixed. */
function extractJson(text: string): string {
  const trimmed = text.trim()
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const body = fenced ? fenced[1]!.trim() : trimmed
  const start = body.indexOf("{")
  const end = body.lastIndexOf("}")
  if (start !== -1 && end !== -1 && end > start) {
    return body.slice(start, end + 1)
  }
  return body
}

function buildEvidence(
  market: GeminiMarket,
  id: string,
  publishedAt: string,
  fallbackUrl: string,
): MarketEvidence[] {
  const items: MarketEvidence[] = []
  const list = Array.isArray(market.evidence) ? market.evidence : []

  list.forEach((evidence, index) => {
    const url = normalizeUrl(evidence?.url)
    const title = evidence?.title?.trim()
    const summary = evidence?.summary?.trim()
    const publisher = evidence?.publisher?.trim()
    if (!url || !title || !summary || !publisher) return
    const kind = (EVIDENCE_KINDS as readonly string[]).includes(
      evidence?.kind ?? "",
    )
      ? (evidence!.kind as MarketEvidence["kind"])
      : "background"
    items.push({
      id: `${id}-evidence-${index}`,
      title: title.slice(0, 240),
      summary: summary.slice(0, 1000),
      publisher: publisher.slice(0, 160),
      url,
      publishedAt,
      kind,
      isDemo: true,
    })
  })

  if (items.length === 0) {
    const publisher = market.resolutionSource?.trim() || "Official source"
    items.push({
      id: `${id}-evidence-source`,
      title: publisher.slice(0, 240),
      summary:
        "Official source proposed for resolution. Pool balances and the trend graph shown here are sample data.",
      publisher: publisher.slice(0, 160),
      url: fallbackUrl,
      publishedAt,
      kind: "resolution-source",
      isDemo: true,
    })
  }

  return items
}

function mapMarket(market: GeminiMarket, index: number): ClimateMarket | null {
  const category = market.category as MarketCategory
  const continent = market.continent as MarketContinent
  if (!(MARKET_CATEGORIES as readonly string[]).includes(category)) return null
  if (!(MARKET_CONTINENTS as readonly string[]).includes(continent)) return null

  const question = market.question?.trim()
  const description = market.description?.trim()
  const region = market.region?.trim()
  const resolutionSource = market.resolutionSource?.trim()
  const resolutionRules = market.resolutionRules?.trim()
  if (
    !question ||
    !description ||
    !region ||
    !resolutionSource ||
    !resolutionRules
  ) {
    return null
  }

  const latitude = Number(market.latitude)
  const longitude = Number(market.longitude)
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) return null
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    return null
  }

  const resolutionSourceUrl = normalizeUrl(market.resolutionSourceUrl)
  if (!resolutionSourceUrl) return null

  const yes = round(
    clamp(Number(market.estimatedProbability) || 0.5, 0.05, 0.95),
    2,
  )
  const no = round(1 - yes, 2)

  const now = Date.now()
  const closeInDays = clamp(
    Math.round(Number(market.closeInDays) || 60),
    7,
    300,
  )
  const createdAt = new Date(now).toISOString()
  const closeTime = new Date(now + closeInDays * DAY_MS).toISOString()
  const resolutionTime = new Date(
    now + (closeInDays + 14) * DAY_MS,
  ).toISOString()

  const id = `gemini-${slugify(question)}-${index}`.slice(0, 110)
  const slug = `${slugify(question)}-${index}`.slice(0, 110)
  const total = 700 + index * 25
  const yesLiquidity = round(total * yes)
  const noLiquidity = round(total - yesLiquidity)

  const evidence = buildEvidence(market, id, createdAt, resolutionSourceUrl)

  const climateMarket: ClimateMarket = {
    id,
    onchainMarketId: 2000 + index,
    question: (question.includes("[DEMO]")
      ? question
      : `[DEMO] ${question}`
    ).slice(0, 400),
    slug,
    description: description.slice(0, 2000),
    category,
    continent,
    country: market.country?.trim().slice(0, 100) || undefined,
    region: region.slice(0, 160),
    latitude,
    longitude,
    closeTime,
    resolutionTime,
    status: "open",
    outcome: "unresolved",
    yesPrice: yes,
    noPrice: no,
    yesLiquidity,
    noLiquidity,
    totalVolume: round(900 + yes * 4200),
    participants: Math.round(70 + yes * 260),
    resolutionSource: resolutionSource.slice(0, 300),
    resolutionSourceUrl,
    resolutionRules: resolutionRules.slice(0, 4000),
    resolver: DEMO_WALLETS.cirrus,
    createdAt,
    featured: index < 4,
    trendingScore: clamp(Math.round(45 + yes * 45), 0, 100),
    history: buildHistory({
      start: createdAt,
      yesProbabilities: trendTo(yes),
      baseLiquidity: total,
      baseVolume: round(600 + yes * 1500),
    }),
    evidence,
    recentTrades: buildTrades(id, [
      ["yes", round(0.5 + yes * 3, 2), yes, isoDaysAgo(0)],
      ["no", round(0.5 + no * 2.5, 2), no, isoDaysAgo(1)],
      [
        "yes",
        round(0.4 + yes * 1.5, 2),
        round(clamp(yes - 0.02, 0.02, 0.98), 2),
        isoDaysAgo(2),
      ],
    ]),
    network: "devnet",
    settlementAsset: "SOL",
    marketModel: "pooled-binary",
    isDemo: true,
    dataLabel: "SAMPLE DATA",
    dataDisclaimer: DEMO_DATA_DISCLAIMER,
  }

  const validated = climateMarketSchema.safeParse(climateMarket)
  if (!validated.success) {
    console.warn(
      `[gemini] dropped invalid market "${question}":`,
      validated.error.issues[0]?.message,
    )
    return null
  }
  return climateMarket
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(
        () => reject(new Error(`Gemini request timed out after ${ms}ms`)),
        ms,
      ),
    ),
  ])
}

async function callGemini(): Promise<GeminiMarket[]> {
  if (!API_KEY) throw new Error("GEMINI_API_KEY is not set")
  const ai = new GoogleGenAI({ apiKey: API_KEY })
  const today = new Date().toISOString().slice(0, 10)
  const interaction = await withTimeout(
    ai.interactions.create({
      model: MODEL,
      input: `Today's date is ${today}.\n\n${PROMPT}`,
    }),
    GENERATION_TIMEOUT_MS,
  )
  const text = interaction.output_text
  if (!text) throw new Error("Gemini returned an empty response")
  const parsed = JSON.parse(extractJson(text)) as { markets?: GeminiMarket[] }
  if (!Array.isArray(parsed.markets) || parsed.markets.length === 0) {
    throw new Error("Gemini response contained no markets")
  }
  return parsed.markets
}

async function generate(): Promise<ClimateMarket[]> {
  const raw = await callGemini()
  const mapped = raw
    .map((market, index) => mapMarket(market, index))
    .filter((market): market is ClimateMarket => market !== null)
  console.info(
    `[gemini] ${mapped.length}/${raw.length} generated markets passed validation (requested ${MARKET_COUNT})`,
  )
  if (mapped.length === 0) {
    throw new Error("Gemini returned no schema-valid markets")
  }
  return mapped
}

async function readCache(): Promise<ClimateMarket[] | null> {
  try {
    const raw = await readFile(CACHE_FILE, "utf8")
    const parsed = JSON.parse(raw) as CacheShape
    if (parsed.model !== MODEL) return null
    if (parsed.count !== MARKET_COUNT) return null
    if (Date.now() - parsed.generatedAt > CACHE_TTL_MS) return null
    const valid = parsed.markets.filter(
      (market) => climateMarketSchema.safeParse(market).success,
    )
    return valid.length > 0 ? valid : null
  } catch {
    return null
  }
}

async function writeCache(markets: ClimateMarket[]): Promise<void> {
  try {
    await mkdir(CACHE_DIR, { recursive: true })
    const payload: CacheShape = {
      generatedAt: Date.now(),
      model: MODEL,
      count: MARKET_COUNT,
      markets,
    }
    await writeFile(CACHE_FILE, JSON.stringify(payload), "utf8")
  } catch {
    // Caching is best-effort; ignore write failures.
  }
}

/**
 * Returns Gemini-generated climate markets, cached on disk to respect free-tier
 * quota. Falls back to bundled sample markets whenever the key is missing, the
 * API errors (including 429 quota exhaustion), or the response fails validation.
 */
export async function getInitialClimateMarkets(): Promise<MarketGenerationResult> {
  if (memoryCache) return { markets: memoryCache, source: "gemini" }
  if (!API_KEY) {
    return {
      markets: demoMarkets,
      source: "sample",
      error: "GEMINI_API_KEY not set",
    }
  }
  if (Date.now() < failedUntil) {
    return {
      markets: demoMarkets,
      source: "sample",
      error: "recent generation failure",
    }
  }

  try {
    const cached = await readCache()
    if (cached) {
      memoryCache = cached
      return { markets: cached, source: "gemini" }
    }

    inFlight ??= generate()
    const markets = await inFlight
    memoryCache = markets
    void writeCache(markets)
    return { markets, source: "gemini" }
  } catch (error) {
    failedUntil = Date.now() + FAILURE_BACKOFF_MS
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`[gemini] generation failed, using sample markets: ${message}`)
    return { markets: demoMarkets, source: "sample", error: message }
  } finally {
    inFlight = null
  }
}
