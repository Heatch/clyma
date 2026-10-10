import { complete } from "../llm/backboard.mjs"

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

const FALLBACK_PROBABILITY = 0.5
const INFERENCE_TIMEOUT_MS = 30_000

function forecastModel(): string {
  return process.env.LLM_MODEL?.trim() || "gpt-5.6-luna"
}

/** Parses the model output: strict "0.42" first, then any lone decimal. */
function parseProbability(raw: string): {
  probability: number
  formatValid: boolean
} {
  const strict = raw.match(/^(0\.\d{2}|1\.00)$/)
  if (strict) {
    return { probability: Number.parseFloat(strict[1]!), formatValid: true }
  }

  const loose = raw.match(/\b(0(?:\.\d+)?|1(?:\.0+)?)\b/)
  if (loose) {
    const value = Number.parseFloat(loose[1]!)
    if (Number.isFinite(value)) {
      return {
        probability: Math.min(1, Math.max(0, value)),
        formatValid: false,
      }
    }
  }

  return { probability: FALLBACK_PROBABILITY, formatValid: false }
}

/**
 * Single seam for calibrated YES-probability forecasts. Reads provider
 * credentials from the environment and delegates to the configured provider
 * (GPT Luna via Backboard). Callers never see provider names or model ids.
 *
 * Throws when `BACKBOARD_API_KEY` is missing; errors propagate to the
 * caller — there is no fallback provider.
 */
export async function getForecast(input: ForecastInput): Promise<ForecastResult> {
  const prompt =
    "You are a highly calibrated forecasting agent. Your goal is to predict " +
    "the probability of climate-related events occurring based on the market's " +
    "resolution rules and the available context.\n" +
    "You must output ONLY a float value between 0.00 and 1.00 representing the " +
    "probability, formatted to exactly two decimal places. Do not output any other text.\n\n" +
    `Question: ${input.question}\n` +
    `Resolution Rules: ${input.rules ?? "Not provided."}\n` +
    `Context: ${input.context ?? "No additional context available. Forecast from the resolution rules and climate priors."}\n\n` +
    "What is the probability of this event occurring? (0.00 to 1.00):"

  const result = await complete({
    model: forecastModel(),
    userContent: prompt,
    json: false,
    timeoutMs: INFERENCE_TIMEOUT_MS,
  })
  const rawOutput = result.text.trim()
  const { probability, formatValid } = parseProbability(rawOutput)

  return {
    probability,
    rawOutput,
    formatValid,
    fallback: FALLBACK_PROBABILITY,
  }
}

export { INFERENCE_TIMEOUT_MS }
