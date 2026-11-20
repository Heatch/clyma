import { getForecast } from "../forecast"

interface ProbabilityPayload {
  question: string
  region: string
  category: string
  news_context: string
}

/**
 * Opening probability for a new market, taken from the same model seam the
 * forecast route uses (`lib/forecast`). Calls it in-process instead of
 * over HTTP: no self-fetch, no base-URL guesswork, and no extra Worker
 * request against the platform's limits.
 *
 * Throws when inference fails — callers surface the error instead of
 * silently opening at 0.5.
 */
export async function fetchOpeningProbability(
  payload: ProbabilityPayload,
): Promise<number> {
  try {
    const result = await getForecast({
      question: payload.question,
      rules: `Region: ${payload.region}, Category: ${payload.category}`,
      context: payload.news_context,
    })
    return result.probability
  } catch (error) {
    console.error("Failed to reach forecast route:", error)
    throw error instanceof Error ? error : new Error(String(error))
  }
}
