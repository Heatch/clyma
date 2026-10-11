import React from "react"
import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import MarketChart from "@/components/markets/MarketChart"
import type { MarketHistoryPoint } from "@/lib/markets/types"

const history: MarketHistoryPoint[] = [
  {
    timestamp: "2026-09-01T00:00:00.000Z",
    yesProbability: 0.52,
    noProbability: 0.48,
    totalVolume: 1,
    yesLiquidity: 0.5,
    noLiquidity: 0.5,
  },
  {
    timestamp: "2026-09-02T00:00:00.000Z",
    yesProbability: 0.57,
    noProbability: 0.43,
    totalVolume: 2,
    yesLiquidity: 1,
    noLiquidity: 1,
  },
]

describe("MarketChart", () => {
  it("omits the model reference line while keeping the trade preview", () => {
    render(<MarketChart history={history} tone="dark" previewProb={0.75} />)

    expect(screen.getByText("YES probability")).toBeInTheDocument()
    expect(screen.queryByText(/model/i)).not.toBeInTheDocument()
    expect(screen.getByText(/preview/i)).toBeInTheDocument()
  })
})
