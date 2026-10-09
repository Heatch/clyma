import { NextRequest, NextResponse } from "next/server"

import { GoogleGenAI } from "@google/genai"

/**
 * POST /api/predict
 *
 * Gemini-backed calibrated probability forecast for a climate market.
 *
 * 1. Receives the market question and resolution rules.
 * 2. Optionally uses caller-provided news context (no live retrieval).
 * 3. Asks Gemini for a calibrated YES probability and validates the output.
 *
 * Environment variables required:
 *   GEMINI_API_KEY  — Google AI Studio API key
 *   GEMINI_MODEL    — (Optional) model id, defaults to `gemini-3.5-flash`
 */

const FALLBACK_PROBABILITY = 0.5
const INFERENCE_TIMEOUT_MS = 15_000

interface PredictBody {
  question?: string
  resolution_rules?: string
  news_context?: string
}

function forecastModel(): string {
  return process.env.GEMINI_MODEL?.trim() || "gemini-3.5-flash"
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

export async function POST(request: NextRequest) {
  const apiKey = process.env.GEMINI_API_KEY?.trim()
  const model = forecastModel()

  if (!apiKey) {
    return NextResponse.json(
      {
        error: "server_misconfigured",
        detail: "GEMINI_API_KEY must be set in .env",
      },
      { status: 500 },
    )
  }

  let body: PredictBody
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 })
  }

  if (!body.question) {
    return NextResponse.json({ error: "missing_question" }, { status: 400 })
  }

  const newsContext = body.news_context?.trim() || null

  const prompt =
    "You are a highly calibrated forecasting agent. Your goal is to predict " +
    "the probability of climate-related events occurring based on the market's " +
    "resolution rules and the available context.\n" +
    "You must output ONLY a float value between 0.00 and 1.00 representing the " +
    "probability, formatted to exactly two decimal places. Do not output any other text.\n\n" +
    `Question: ${body.question}\n` +
    `Resolution Rules: ${body.resolution_rules ?? "Not provided."}\n` +
    `Context: ${newsContext ?? "No additional context available. Forecast from the resolution rules and climate priors."}\n\n` +
    "What is the probability of this event occurring? (0.00 to 1.00):"

  try {
    const ai = new GoogleGenAI({ apiKey })
    const interaction = await withTimeout(
      ai.interactions.create({ model, input: prompt }),
      INFERENCE_TIMEOUT_MS,
    )
    const rawOutput = interaction.output_text?.trim() ?? ""
    const { probability, formatValid } = parseProbability(rawOutput)

    return NextResponse.json({
      probability,
      raw_output: rawOutput,
      model,
      format_valid: formatValid,
      news_context_used: newsContext,
    })
  } catch (err: unknown) {
    const isTimeout = err instanceof Error && err.message.includes("timed out")
    console.error(`[/api/predict] ${isTimeout ? "Timeout" : "Error"}: ${err}`)

    return NextResponse.json(
      {
        error: "inference_unavailable",
        detail: isTimeout
          ? `Request timed out after ${INFERENCE_TIMEOUT_MS}ms`
          : String(err),
        fallback: FALLBACK_PROBABILITY,
      },
      { status: 502 },
    )
  }
}
