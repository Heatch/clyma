import { NextRequest, NextResponse } from 'next/server';

/**
 * POST /api/predict
 *
 * Implements Option A: Just-In-Time News Retrieval (RAG) + Calibrated Inference.
 * 
 * 1. Receives the market question and resolution rules.
 * 2. Fetches recent news context published in the days prior to the event (via Tavily/Search or fallback).
 * 3. Appends the live news context to the prompt.
 * 4. Queries the Freesolo GRPO model endpoint.
 *
 * Environment variables required:
 *   FREESOLO_API_KEY    — API key for the Freesolo/Modal endpoint
 *   GRPO_ADAPTER_ID     — Run ID of the deployed GRPO adapter (e.g. "flash-XXXX-YYYY")
 *   TAVILY_API_KEY      — (Optional) API key for real-time news retrieval
 */

const FREESOLO_BASE_URL =
  'https://clado-ai--freesolo-lora-serving.modal.run/v1';

const INFERENCE_TIMEOUT_MS = 6_000;

/**
 * Helper: Fetches recent news context prior to the event.
 */
async function fetchRecentNewsContext(question: string): Promise<string> {
  const tavilyKey = process.env.TAVILY_API_KEY;

  if (tavilyKey) {
    try {
      const response = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: tavilyKey,
          query: `climate weather news: ${question}`,
          search_depth: 'basic',
          max_results: 3,
        }),
        signal: AbortSignal.timeout(2500),
      });

      if (response.ok) {
        const data = await response.json();
        const snippets = data?.results
          ?.map((r: { title: string; content: string }) => `${r.title}: ${r.content}`)
          .join('\n');
        if (snippets) {
          return snippets.slice(0, 1000);
        }
      }
    } catch {
      // Ignore search errors, fallback to default
    }
  }

  return 'No recent news context available. Forecast based on resolution rules and internal climate priors.';
}

export async function POST(request: NextRequest) {
  const apiKey = process.env.FREESOLO_API_KEY;
  const adapterId = process.env.GRPO_ADAPTER_ID;

  if (!apiKey || !adapterId) {
    return NextResponse.json(
      {
        error: 'server_misconfigured',
        detail:
          'FREESOLO_API_KEY and GRPO_ADAPTER_ID must be set in .env.local',
      },
      { status: 500 }
    );
  }

  let body: { question?: string; resolution_rules?: string; news_context?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'invalid_json' },
      { status: 400 }
    );
  }

  if (!body.question) {
    return NextResponse.json(
      { error: 'missing_question' },
      { status: 400 }
    );
  }

  // 1. Just-In-Time News Retrieval (Option A)
  const newsContext = body.news_context || (await fetchRecentNewsContext(body.question));

  const systemPrompt =
    'You are a highly calibrated forecasting agent. Your goal is to predict ' +
    "the probability of climate-related events occurring based on the market's " +
    'resolution rules and recent news context.\n' +
    'You must output ONLY a float value between 0.00 and 1.00 representing the ' +
    'probability, formatted to exactly two decimal places. Do not output any other text.';

  const userPrompt =
    `Question: ${body.question}\n` +
    `Resolution Rules: ${body.resolution_rules ?? 'Not provided.'}\n` +
    `Recent News Context (Prior 72h): ${newsContext}\n\n` +
    'What is the probability of this event occurring? (0.00 to 1.00):';

  // 6-second abort controller for the outbound fetch.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), INFERENCE_TIMEOUT_MS);

  try {
    const response = await fetch(
      `${FREESOLO_BASE_URL}/chat/completions`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: adapterId,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          max_tokens: 10,
          temperature: 0.0,
        }),
        signal: controller.signal,
      }
    );

    clearTimeout(timeout);

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'unknown');
      console.error(
        `[/api/predict] Freesolo returned ${response.status}: ${errorText}`
      );
      return NextResponse.json(
        {
          error: 'inference_unavailable',
          detail: `Upstream returned ${response.status}`,
          fallback: 0.5,
        },
        { status: 502 }
      );
    }

    const data = await response.json();
    const rawPrediction =
      data?.choices?.[0]?.message?.content?.trim() ?? '';

    // Validate the model's output against our expected format.
    const match = rawPrediction.match(/^(0\.\d{2}|1\.00)$/);
    const probability = match ? parseFloat(match[1]) : 0.5;

    return NextResponse.json({
      probability,
      raw_output: rawPrediction,
      adapter_id: adapterId,
      format_valid: !!match,
      news_context_used: newsContext,
    });
  } catch (err: unknown) {
    clearTimeout(timeout);

    const isTimeout =
      err instanceof DOMException && err.name === 'AbortError';
    console.error(
      `[/api/predict] ${isTimeout ? 'Timeout' : 'Error'}: ${err}`
    );

    return NextResponse.json(
      {
        error: 'inference_unavailable',
        detail: isTimeout
          ? `Request timed out after ${INFERENCE_TIMEOUT_MS}ms`
          : String(err),
        fallback: 0.5,
      },
      { status: 502 }
    );
  }
}
