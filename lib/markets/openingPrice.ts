interface ProbabilityPayload {
  question: string;
  region: string;
  category: string;
  news_context: string;
}

/**
 * Fetches the opening probability from the Gemini-backed forecast route.
 * Returns a fallback of 0.5 if the route is unreachable or fails.
 */
export async function fetchOpeningProbability(
  payload: ProbabilityPayload
): Promise<number> {
  try {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
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
    });

    if (!response.ok) {
      console.warn(
        `Forecast route returned status: ${response.status}. Using fallback probability.`
      );
      return 0.5;
    }

    const data = await response.json();
    
    if (typeof data.probability === "number") {
      return data.probability;
    }

    console.warn("Invalid response format from forecast route. Using fallback.");
    return 0.5;
  } catch (error) {
    console.error("Failed to reach forecast route. Using fallback:", error);
    return 0.5;
  }
}
