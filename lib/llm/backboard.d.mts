// Types for ./backboard.mjs (plain-JS Backboard client). Kept in sync manually.

export const DEFAULT_BASE_URL: string
export const DEFAULT_LLM_PROVIDER: string
export const MAX_RETRIES: number

export class LlmHttpError extends Error {
  status: number
  readonly retryable: boolean
  constructor(status: number, message: string)
}

export interface LlmResponse {
  text: string
  tokensIn: number
  tokensOut: number
  latencyMs: number
}

export interface CompleteInput {
  model: string
  systemPrompt?: string
  userContent: string
  json?: boolean
  timeoutMs?: number
  fetchImpl?: typeof fetch
}

export function complete(input: CompleteInput): Promise<LlmResponse>
export function extractJson(text: string): string
