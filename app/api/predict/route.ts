import { NextRequest, NextResponse } from "next/server"

import { getForecast, INFERENCE_TIMEOUT_MS } from "@/lib/forecast"

/**
 * POST /api/predict
 *
 * Calibrated probability forecast for a climate market. HTTP layer only:
 * validates the body, delegates inference to `lib/forecast`, and shapes the
 * response. The provider is never named in requests or responses.
 *
 * Body: { question: string, resolution_rules?: string, news_context?: string }
 */

interface PredictBody {
  question?: string
  resolution_rules?: string
  news_context?: string
}

export async function POST(request: NextRequest) {
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

  try {
    const result = await getForecast({
      question: body.question,
      rules: body.resolution_rules,
      context: newsContext,
    })

    return NextResponse.json({
      probability: result.probability,
      raw_output: result.rawOutput,
      forecaster: "model",
      format_valid: result.formatValid,
      news_context_used: newsContext,
    })
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes("BACKBOARD_API_KEY")) {
      return NextResponse.json(
        {
          error: "server_misconfigured",
          detail: "Forecasting is not configured on this server",
        },
        { status: 500 },
      )
    }

    const isTimeout = err instanceof Error && err.message.includes("timed out")
    console.error(`[/api/predict] ${isTimeout ? "Timeout" : "Error"}: ${err}`)

    // No fallback provider: the Model forecast is simply unavailable.
    return NextResponse.json(
      {
        error: "inference_unavailable",
        detail: isTimeout
          ? `Request timed out after ${INFERENCE_TIMEOUT_MS}ms`
          : String(err),
      },
      { status: 502 },
    )
  }
}
