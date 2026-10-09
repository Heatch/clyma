import { GoogleGenAI } from "@google/genai"

import type { ForecastResult } from "./index"

const FALLBACK_PROBABILITY = 0.5

interface GeminiForecastInput {
  question: string
  rules?: string
  context?: string | null
  apiKey: string
  model: string
  timeoutMs: number
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(
        () => reject(new Error(`Forecast request timed out after ${ms}ms`)),
        ms,
      ),
    ),
  ])
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
 * Provider implementation behind `getForecast`. Swapping forecast providers
 * later means replacing this file; the interface in `./index` stays stable.
 */
export async function getGeminiForecast(
  input: GeminiForecastInput,
): Promise<ForecastResult> {
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

  const ai = new GoogleGenAI({ apiKey: input.apiKey })
  const interaction = await withTimeout(
    ai.interactions.create({ model: input.model, input: prompt }),
    input.timeoutMs,
  )
  const rawOutput = interaction.output_text?.trim() ?? ""
  const { probability, formatValid } = parseProbability(rawOutput)

  return {
    probability,
    rawOutput,
    formatValid,
    fallback: FALLBACK_PROBABILITY,
  }
}
