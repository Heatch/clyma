interface ProbabilityPayload {
  question: string
  region: string
  category: string
  news_context: string
}

/**
 * Fetches the opening probability from the model-backed forecast route.
 * Throws when the route is unreachable or fails — callers surface the error
 * instead of silently opening at 0.5.
 */
export async function fetchOpeningProbability(
  payload: ProbabilityPayload,
): Promise<number> {
  try {
    // Server-side self-call. APP_URL (server-only) wins when set; otherwise
    // the public base URL, which must be set before `npm run build` because
    // NEXT_PUBLIC_* values are inlined at build time.
    const baseUrl =
      process.env.APP_URL?.trim() ||
      process.env.NEXT_PUBLIC_APP_URL?.trim() ||
      "http://localhost:3000"
    const response = await fetch(`${baseUrl}/api/predict`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        question: payload.question,
        resolution_rules: `Region: ${payload.region}, Category: ${payload.category}`,
        news_context: payload.news_context,
      }),
    })

    if (!response.ok) {
      throw new Error(`Forecast route returned status: ${response.status}`)
    }

    const data = await response.json()

    if (typeof data.probability === "number") {
      return data.probability
    }

    throw new Error("Invalid response format from forecast route.")
  } catch (error) {
    console.error("Failed to reach forecast route:", error)
    throw error instanceof Error ? error : new Error(String(error))
  }
}
