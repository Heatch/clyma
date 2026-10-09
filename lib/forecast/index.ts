import { getGeminiForecast } from "./gemini"

export interface ForecastInput {
  question: string
  rules?: string
  context?: string | null
}

export interface ForecastResult {
  probability: number
  rawOutput: string
  formatValid: boolean
  /** Probability to use when the provider is unreachable. */
  fallback: number
}

const INFERENCE_TIMEOUT_MS = 15_000

function forecastModel(): string {
  return process.env.GEMINI_MODEL?.trim() || "gemini-3.5-flash"
}

/**
 * Single seam for calibrated YES-probability forecasts. Reads provider
 * credentials from the environment and delegates to the configured provider
 * (currently Gemini). Callers never see provider names or model ids.
 *
 * Throws when `GEMINI_API_KEY` is missing; returns `fallback` probability
 * inside a 502-style error is the caller's (route's) decision.
 */
export async function getForecast(input: ForecastInput): Promise<ForecastResult> {
  const apiKey = process.env.GEMINI_API_KEY?.trim()
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY must be set in .env")
  }

  return getGeminiForecast({
    question: input.question,
    rules: input.rules,
    context: input.context,
    apiKey,
    model: forecastModel(),
    timeoutMs: INFERENCE_TIMEOUT_MS,
  })
}

export { INFERENCE_TIMEOUT_MS }
