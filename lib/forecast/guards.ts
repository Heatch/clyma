/**
 * Guards for the paid forecast endpoint (`POST /api/predict`).
 *
 * Each inference costs real money, and the globe hover prefetch hits the
 * route on every marker hover — so successful forecasts are cached by
 * question text, and callers are rate-limited per IP. Both guards are
 * in-memory (single instance); tune via env.
 */

function envPositiveInt(name: string, fallback: number): number {
  const raw = Number(process.env[name])
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : fallback
}

export const PREDICT_CACHE_TTL_MS = envPositiveInt(
  "PREDICT_CACHE_TTL_MS",
  15 * 60 * 1000,
)
export const PREDICT_RATE_LIMIT_MAX = envPositiveInt(
  "PREDICT_RATE_LIMIT_PER_MINUTE",
  20,
)
const PREDICT_RATE_LIMIT_WINDOW_MS = 60_000
const PREDICT_CACHE_MAX_ENTRIES = 500

interface ForecastCacheEntry {
  expiresAt: number
  body: Record<string, unknown>
}

const forecastCache = new Map<string, ForecastCacheEntry>()
const rateBuckets = new Map<string, { count: number; resetAt: number }>()

/** Normalized cache key: same question + rules + context shares one forecast. */
export function buildPredictCacheKey(
  question: string,
  rules?: string,
  context?: string | null,
): string {
  return [
    question.trim().toLowerCase(),
    (rules ?? "").trim().toLowerCase(),
    (context ?? "").trim(),
  ].join("|")
}

/** Sliding-window per-IP gate. Returns true when the request may proceed. */
export function checkPredictRateLimit(ip: string, now = Date.now()): boolean {
  const bucket = rateBuckets.get(ip)
  if (!bucket || now >= bucket.resetAt) {
    rateBuckets.set(ip, {
      count: 1,
      resetAt: now + PREDICT_RATE_LIMIT_WINDOW_MS,
    })
    return true
  }
  if (bucket.count >= PREDICT_RATE_LIMIT_MAX) return false
  bucket.count += 1
  return true
}

/** Test hook: resets both guards. */
export function clearPredictGuards(): void {
  forecastCache.clear()
  rateBuckets.clear()
}

export function getCachedForecast(
  key: string,
  now = Date.now(),
): Record<string, unknown> | null {
  const entry = forecastCache.get(key)
  if (!entry) return null
  if (now >= entry.expiresAt) {
    forecastCache.delete(key)
    return null
  }
  return entry.body
}

export function setCachedForecast(
  key: string,
  body: Record<string, unknown>,
): void {
  if (forecastCache.size >= PREDICT_CACHE_MAX_ENTRIES) {
    const oldest = forecastCache.keys().next()
    if (!oldest.done) forecastCache.delete(oldest.value)
  }
  forecastCache.set(key, { expiresAt: Date.now() + PREDICT_CACHE_TTL_MS, body })
}
