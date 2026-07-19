"use client";

import { useEffect, useState } from "react";

export interface AIForecastResult {
  probability: number | null;
  loading: boolean;
  error: string | null;
  newsContext: string | null;
  adapterId: string | null;
}

export function useAIForecast(question?: string, resolutionRules?: string): AIForecastResult {
  const [probability, setProbability] = useState<number | null>(null);
  const [newsContext, setNewsContext] = useState<string | null>(null);
  const [adapterId, setAdapterId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!question) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    fetch("/api/predict", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        question: question.replace(/^\[DEMO\]\s*/i, ""),
        resolution_rules: resolutionRules,
      }),
    })
      .then(async (res) => {
        const data = await res.json();
        if (res.ok && typeof data.probability === "number") {
          setProbability(data.probability);
          setNewsContext(data.news_context_used ?? null);
          setAdapterId(data.adapter_id ?? null);
        } else {
          setError(data.error || "Inference unavailable");
          if (typeof data.fallback === "number") {
            setProbability(data.fallback);
          }
        }
      })
      .catch((err) => {
        setError(err.message);
        setProbability(0.5);
      })
      .finally(() => setLoading(false));
  }, [question, resolutionRules]);

  return { probability, loading, error, newsContext, adapterId };
}
