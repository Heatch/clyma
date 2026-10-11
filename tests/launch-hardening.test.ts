import { beforeEach, describe, expect, it, vi } from "vitest"

import { resolveJwtSecretValue } from "@/lib/auth"
import {
  buildPredictCacheKey,
  checkPredictRateLimit,
  clearPredictGuards,
} from "@/lib/forecast/guards"
import { POST as predict } from "@/app/api/predict/route"
import { POST as createMarket } from "@/app/api/markets/create/route"

const forecastMocks = vi.hoisted(() => ({
  getForecast: vi.fn(),
}))

vi.mock("@/lib/forecast", () => ({
  getForecast: forecastMocks.getForecast,
  INFERENCE_TIMEOUT_MS: 30_000,
}))

const openingPriceMocks = vi.hoisted(() => ({
  fetchOpeningProbability: vi.fn(),
}))

vi.mock("@/lib/markets/openingPrice", () => ({
  fetchOpeningProbability: openingPriceMocks.fetchOpeningProbability,
}))

function predictRequest(body: unknown, ip = "10.0.0.1") {
  return new Request("http://localhost/api/predict", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-forwarded-for": ip,
    },
    body: JSON.stringify(body),
  }) as never
}

function createRequest(body: unknown) {
  return new Request("http://localhost/api/markets/create", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  clearPredictGuards()
  forecastMocks.getForecast.mockResolvedValue({
    probability: 0.42,
    rawOutput: "0.42",
    formatValid: true,
    fallback: 0.5,
  })
  openingPriceMocks.fetchOpeningProbability.mockResolvedValue(0.6)
  delete process.env.ENABLE_MARKET_CREATE
})

describe("jwt secret resolution", () => {
  it("prefers the configured secret", () => {
    expect(
      resolveJwtSecretValue({ JWT_SECRET: "  live-secret  " }),
    ).toBe("live-secret")
  })

  it("falls back to the dev secret outside production", () => {
    expect(resolveJwtSecretValue({ NODE_ENV: "test" })).toBe(
      "dev-secret-change-in-production",
    )
  })

  it("refuses to start in production without a secret", () => {
    expect(() => resolveJwtSecretValue({ NODE_ENV: "production" })).toThrow(
      /JWT_SECRET must be set in production/,
    )
  })
})

describe("predict guards", () => {
  it("rejects a missing question before touching inference", async () => {
    const response = await predict(predictRequest({}))
    expect(response.status).toBe(400)
    expect(forecastMocks.getForecast).not.toHaveBeenCalled()
  })

  it("caches repeat forecasts by question text", async () => {
    const body = { question: "Will test city flood in 2027?" }

    const first = await predict(predictRequest(body, "10.0.0.2"))
    const firstBody = (await first.json()) as {
      probability: number
      cached: boolean
    }
    expect(first.status).toBe(200)
    expect(firstBody.probability).toBe(0.42)
    expect(firstBody.cached).toBe(false)

    const second = await predict(predictRequest(body, "10.0.0.3"))
    const secondBody = (await second.json()) as {
      probability: number
      cached: boolean
    }
    expect(secondBody.cached).toBe(true)
    expect(forecastMocks.getForecast).toHaveBeenCalledTimes(1)
  })

  it("treats equivalent questions as the same cache key", () => {
    expect(buildPredictCacheKey("  Will TEST city flood? ", "Region: X")).toBe(
      buildPredictCacheKey("will test city flood?", "region: x"),
    )
  })

  it("rate-limits a hot IP without calling inference again", async () => {
    const body = { question: "Will test city flood in 2027?" }
    const ip = "10.0.0.9"
    for (let i = 0; i < 20; i++) {
      const response = await predict(
        predictRequest({ ...body, news_context: `ctx-${i}` }, ip),
      )
      expect(response.status).toBe(200)
    }
    const limited = await predict(
      predictRequest({ ...body, news_context: "ctx-final" }, ip),
    )
    expect(limited.status).toBe(429)
    const limitedBody = (await limited.json()) as { error: string }
    expect(limitedBody.error).toBe("rate_limited")
    // 20 inference calls for the 20 allowed requests; the 21st never ran.
    expect(forecastMocks.getForecast).toHaveBeenCalledTimes(20)
  })

  it("scopes rate limits per IP", () => {
    expect(checkPredictRateLimit("10.0.0.11")).toBe(true)
    expect(checkPredictRateLimit("10.0.0.12")).toBe(true)
  })
})

describe("market creation gate", () => {
  it("is disabled by default without triggering inference", async () => {
    const response = await createMarket(
      createRequest({
        question: "Will test city flood in 2027?",
        region: "Test Region",
        category: "flood",
        news_context: "context",
      }),
    )
    const body = (await response.json()) as {
      error: { code: string }
    }
    expect(response.status).toBe(503)
    expect(body.error.code).toBe("SERVICE_DISABLED")
    expect(openingPriceMocks.fetchOpeningProbability).not.toHaveBeenCalled()
  })

  it("proceeds when explicitly enabled", async () => {
    process.env.ENABLE_MARKET_CREATE = "true"
    try {
      const response = await createMarket(
        createRequest({
          question: "Will test city flood in 2027?",
          region: "Test Region",
          category: "flood",
          news_context: "context",
        }),
      )
      const body = (await response.json()) as {
        data: { probability: number }
      }
      expect(response.status).toBe(200)
      expect(body.data.probability).toBe(0.6)
      expect(openingPriceMocks.fetchOpeningProbability).toHaveBeenCalledOnce()
    } finally {
      delete process.env.ENABLE_MARKET_CREATE
    }
  })
})
