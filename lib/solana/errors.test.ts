// @vitest-environment node
import { describe, expect, it } from "vitest"

import { extractCustomProgramErrorCode, toMarketProgramError } from "./errors"

describe("Solana error mapping", () => {
  it("extracts Anchor custom error codes from transaction logs", () => {
    const error = {
      message: "Transaction simulation failed",
      logs: [
        "Program log: AnchorError occurred. Error Code: AlreadyClaimed. Error Number: 6018.",
      ],
    }

    expect(extractCustomProgramErrorCode(error)).toBe(6018)
    expect(toMarketProgramError(error).message).toContain(
      "already been claimed",
    )
  })

  it("turns wallet rejection errors into a useful user-facing state", () => {
    const mapped = toMarketProgramError(new Error("User rejected the request"))

    expect(mapped.code).toBe("wallet_rejected")
    expect(mapped.message).toContain("cancelled")
  })
})
