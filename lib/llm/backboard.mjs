// lib/llm/backboard.mjs — shared Backboard threads-API client.
//
// Single model-access layer for the TS app and scripts/*.mjs. Contract per
// backboard.md: POST {base}/threads/messages with an X-API-Key header
// (NOT OpenAI-compatible: no /chat/completions, no Bearer tokens).
// Retries follow backboard.md section 7: 429/5xx/network errors retry with
// exponential backoff (max 2 retries); 400/401/404 fail fast; a JSON-output
// parse failure retries once with the validation error appended, then fails.
// There is deliberately no fallback provider and no budget gate.

export const DEFAULT_BASE_URL = "https://app.backboard.io/api"
export const DEFAULT_LLM_PROVIDER = "openai"
export const MAX_RETRIES = 2

export class LlmHttpError extends Error {
  constructor(status, message) {
    super(message)
    this.name = "LlmHttpError"
    this.status = status
  }

  get retryable() {
    return this.status === 429 || (this.status >= 500 && this.status <= 599)
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms),
    ),
  ])
}

function readConfig() {
  const apiKey = process.env.BACKBOARD_API_KEY?.trim()
  if (!apiKey) {
    throw new Error("BACKBOARD_API_KEY must be set in .env")
  }
  return {
    apiKey,
    baseUrl:
      process.env.BACKBOARD_BASE_URL?.trim().replace(/\/+$/, "") || DEFAULT_BASE_URL,
    llmProvider: process.env.BACKBOARD_LLM_PROVIDER?.trim() || DEFAULT_LLM_PROVIDER,
  }
}

async function postOnce(
  { baseUrl, apiKey, llmProvider },
  { model, systemPrompt, userContent, json },
  fetchImpl,
) {
  const body = {
    content: userContent,
    llm_provider: llmProvider,
    model_name: model,
    json_output: json ?? false,
    stream: false,
    memory: "off",
    web_search: "off",
  }
  if (systemPrompt !== undefined) body.system_prompt = systemPrompt

  let res
  try {
    res = await fetchImpl(`${baseUrl}/threads/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": apiKey },
      body: JSON.stringify(body),
    })
  } catch (err) {
    throw new Error(`Network error calling Backboard: ${err.message ?? err}`)
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new LlmHttpError(res.status, `Backboard HTTP ${res.status}: ${text.slice(0, 300)}`)
  }
  const data = await res.json()
  return {
    text: data?.content ?? "",
    tokensIn: typeof data?.input_tokens === "number" ? data.input_tokens : 0,
    tokensOut: typeof data?.output_tokens === "number" ? data.output_tokens : 0,
  }
}

function isRetryable(err) {
  if (err instanceof LlmHttpError) return err.retryable
  return (
    err instanceof Error &&
    (err.message.startsWith("Network error calling Backboard") ||
      err.message.includes("timed out after"))
  )
}

/**
 * One-shot completion via Backboard. Throws on failure (no fallback).
 *
 * @param {object} args
 * @param {string} args.model            e.g. "gpt-5.6-luna"
 * @param {string} [args.systemPrompt]
 * @param {string} args.userContent
 * @param {boolean} [args.json]          set json_output for parsed responses
 * @param {number} [args.timeoutMs]      per-attempt timeout (default 60000)
 * @param {Function} [args.fetchImpl]    fetch override (tests)
 */
export async function complete({
  model,
  systemPrompt,
  userContent,
  json,
  timeoutMs = 60000,
  fetchImpl = fetch,
}) {
  const config = readConfig()
  const started = Date.now()
  let attempt = 0
  let jsonRetried = false
  let pendingValidationError = null

  for (;;) {
    const content =
      pendingValidationError !== null
        ? `${userContent}\n\nPrevious response failed validation: ${pendingValidationError}\nRespond with valid output.`
        : userContent
    try {
      const result = await withTimeout(
        postOnce(config, { model, systemPrompt, userContent: content, json }, fetchImpl),
        timeoutMs,
        "Backboard request",
      )
      if (json) {
        try {
          JSON.parse(extractJson(result.text))
        } catch (err) {
          if (!jsonRetried) {
            jsonRetried = true
            pendingValidationError = err.message
            continue
          }
          throw new Error(`Backboard returned invalid JSON: ${err.message}`)
        }
      }
      return { ...result, latencyMs: Date.now() - started }
    } catch (err) {
      if (
        err instanceof Error &&
        err.message.startsWith("Backboard returned invalid JSON")
      ) {
        throw err
      }
      if (isRetryable(err) && attempt < MAX_RETRIES) {
        await sleep(1000 * 2 ** attempt)
        attempt++
        continue
      }
      throw err
    }
  }
}

/** Pulls a JSON object out of a response that may be fenced or prefixed. */
export function extractJson(text) {
  const trimmed = (text ?? "").trim()
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const body = fenced ? fenced[1].trim() : trimmed
  const start = body.indexOf("{")
  const end = body.lastIndexOf("}")
  if (start !== -1 && end !== -1 && end > start) {
    return body.slice(start, end + 1)
  }
  return body
}
