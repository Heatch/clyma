import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  complete,
  extractJson,
  LlmHttpError,
} from "@/lib/llm/backboard.mjs"

function okResponse(body: Record<string, unknown>, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  }
}

function errResponse(status: number, text = "error") {
  return {
    ok: false,
    status,
    json: async () => ({}),
    text: async () => text,
  }
}

beforeEach(() => {
  vi.unstubAllEnvs()
  vi.stubEnv("BACKBOARD_API_KEY", "test-key")
  vi.stubEnv("BACKBOARD_BASE_URL", "")
  vi.stubEnv("BACKBOARD_LLM_PROVIDER", "")
})

describe("backboard client", () => {
  it("posts the threads contract and maps the response", async () => {
    const fetchImpl = vi.fn(async () =>
      okResponse({ content: "0.42", input_tokens: 10, output_tokens: 3 }),
    )
    const result = await complete({
      model: "gpt-5.6-luna",
      systemPrompt: "sys",
      userContent: "ping",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(fetchImpl).toHaveBeenCalledOnce()
    const [url, init] = fetchImpl.mock.calls[0]! as unknown as [string, RequestInit]
    expect(url).toBe("https://app.backboard.io/api/threads/messages")
    expect(init.method).toBe("POST")
    expect((init.headers as Record<string, string>)["X-API-Key"]).toBe("test-key")
    expect((init.headers as Record<string, string>)["Authorization"]).toBeUndefined()
    const body = JSON.parse(init.body as string)
    expect(body).toMatchObject({
      content: "ping",
      system_prompt: "sys",
      llm_provider: "openai",
      model_name: "gpt-5.6-luna",
      json_output: false,
      stream: false,
      memory: "off",
      web_search: "off",
    })
    expect(result).toMatchObject({ text: "0.42", tokensIn: 10, tokensOut: 3 })
    expect(typeof result.latencyMs).toBe("number")
  })

  it(
    "retries 429/5xx then succeeds, and gives up after 2 retries",
    async () => {
    const okImpl = vi.fn(async () => okResponse({ content: "ok" }))
    okImpl
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(errResponse(503))
    const result = await complete({
      model: "gpt-5.6-luna",
      userContent: "ping",
      fetchImpl: okImpl as unknown as typeof fetch,
    })
    expect(result.text).toBe("ok")
    expect(okImpl).toHaveBeenCalledTimes(3)

    const alwaysFail = vi.fn(async () => errResponse(500))
    await expect(
      complete({
        model: "gpt-5.6-luna",
        userContent: "ping",
        timeoutMs: 5000,
        fetchImpl: alwaysFail as unknown as typeof fetch,
      }),
    ).rejects.toBeInstanceOf(LlmHttpError)
    expect(alwaysFail).toHaveBeenCalledTimes(3)
    },
    30000,
  )

  it("fails fast on 401 without retrying", async () => {
    const fetchImpl = vi.fn(async () => errResponse(401, "bad key"))
    const err = await complete({
      model: "gpt-5.6-luna",
      userContent: "ping",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    }).catch((e) => e)
    expect(err).toBeInstanceOf(LlmHttpError)
    expect((err as LlmHttpError).retryable).toBe(false)
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it("retries invalid JSON once with the validation error, then fails", async () => {
    const fetchImpl = vi.fn(async () => okResponse({ content: "not json" }))
    await expect(
      complete({
        model: "gpt-5.6-luna",
        userContent: '{"a":1}',
        json: true,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/invalid JSON/)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    const secondBody = JSON.parse(
      (fetchImpl.mock.calls[1]! as unknown as [string, RequestInit])[1].body as string,
    )
    expect(secondBody.content).toContain("Previous response failed validation")
  })

  it("requires BACKBOARD_API_KEY", async () => {
    vi.stubEnv("BACKBOARD_API_KEY", "")
    await expect(
      complete({
        model: "gpt-5.6-luna",
        userContent: "ping",
        fetchImpl: (async () => okResponse({})) as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/BACKBOARD_API_KEY/)
  })
})

describe("extractJson", () => {
  it("strips fences and prefixes", () => {
    expect(extractJson('```json\n{"a":1}\n```')).toBe('{"a":1}')
    expect(extractJson('prefix {"a":1} suffix')).toBe('{"a":1}')
    expect(extractJson('{"a":1}')).toBe('{"a":1}')
  })
})
