import React from "react"
import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import {
  MarketProvider,
  useMarkets,
} from "@/components/providers/MarketProvider"
import { fixtureMarkets } from "@/lib/markets/data"
import { TRADE_CONFIRMED_EVENT } from "@/lib/markets/types"

const { mockConnection } = vi.hoisted(() => ({ mockConnection: {} }))

vi.mock("@/components/providers/SolanaProvider", () => ({
  useSolanaWallet: () => ({ connection: mockConnection }),
}))

function VolumeHarness() {
  const { browseResults } = useMarkets()
  const market = browseResults[0]

  return <p data-testid="market-volume">{market?.totalVolume}</p>
}

describe("market provider trade volume", () => {
  it("applies a confirmed trade immediately and keeps it after refresh", async () => {
    const market = fixtureMarkets.find((item) => item.status === "open")!
    render(
      <MarketProvider initialMarkets={[market]}>
        <VolumeHarness />
      </MarketProvider>,
    )

    expect(screen.getByTestId("market-volume")).toHaveTextContent(
      String(market.totalVolume),
    )

    window.dispatchEvent(
      new CustomEvent(TRADE_CONFIRMED_EVENT, {
        detail: {
          marketId: market.id,
          side: "yes",
          amountSol: 0.25,
          yesProbabilityAfter: 0.6,
          noProbabilityAfter: 0.4,
        },
      }),
    )
    expect(await screen.findByTestId("market-volume")).toHaveTextContent(
      String(market.totalVolume + 0.25),
    )

    window.dispatchEvent(new Event("terraform:market-state-changed"))
    expect(await screen.findByTestId("market-volume")).toHaveTextContent(
      String(market.totalVolume + 0.25),
    )
  })
})
