import { NextResponse } from "next/server"

export interface ApiMeta {
  generatedAt: string
  network: "devnet"
}

export interface ApiSuccessResponse<T> {
  data: T
  meta: ApiMeta
}

export type ApiErrorCode =
  | "INVALID_JSON"
  | "VALIDATION_ERROR"
  | "MARKET_NOT_FOUND"
  | "REGION_NOT_FOUND"
  | "MARKET_ID_MISMATCH"
  | "DUPLICATE_SIGNATURE"
  | "INTERNAL_ERROR"

export interface ApiErrorResponse {
  error: {
    code: ApiErrorCode
    message: string
    details?: unknown
  }
  meta: ApiMeta
}

const createMeta = (): ApiMeta => ({
  generatedAt: new Date().toISOString(),
  network: "devnet",
})

const NO_STORE_HEADERS = { "Cache-Control": "no-store" } as const

export const apiSuccess = <T>(
  data: T,
  status = 200,
): NextResponse<ApiSuccessResponse<T>> =>
  NextResponse.json(
    {
      data,
      meta: createMeta(),
    },
    { status, headers: NO_STORE_HEADERS },
  )

export const apiError = (
  code: ApiErrorCode,
  message: string,
  status: number,
  details?: unknown,
): NextResponse<ApiErrorResponse> =>
  NextResponse.json(
    {
      error: {
        code,
        message,
        ...(details === undefined ? {} : { details }),
      },
      meta: createMeta(),
    },
    { status, headers: NO_STORE_HEADERS },
  )
