import React from "react"
import { render, screen, within } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import PortfolioPanel from "@/components/portfolio/PortfolioPanel"

const controls = vi.hoisted(() => ({
  fetchRemotePositions: vi.fn(),
  selectMarket: vi.fn(),
}))

vi.mock("@/components/providers/SolanaProvider", () => ({
  useSolanaWallet: () => ({ connected: true }),
}))

vi.mock("@/components/providers/PositionProvider", () => ({
  usePositions: () => ({
    positions: [
      {
        id: "position-1",
        wallet: "wallet-1",
        marketId: "market-1",
        marketQuestion:
          "Will the test market resolve before the test deadline?",
        region: "Test region",
        side: "yes",
        amountSol: 0.1,
        estimatedPayoutSol: 0.125,
        signature: "signature-1",
        status: "open",
        createdAt: "2026-10-01T00:00:00.000Z",
      },
    ],
    fetchRemotePositions: controls.fetchRemotePositions,
  }),
}))

vi.mock("@/components/providers/MarketProvider", () => ({
  useMarkets: () => ({
    markets: [{ id: "market-1" }],
    selectMarket: controls.selectMarket,
  }),
}))

describe("PortfolioPanel", () => {
  it("fetches on open, removes manual refresh chrome, and enlarges rows", () => {
    render(<PortfolioPanel />)

    expect(controls.fetchRemotePositions).toHaveBeenCalledTimes(1)
    expect(screen.queryByText("Your account")).not.toBeInTheDocument()
    expect(screen.queryByText("Devnet positions")).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: /refresh/i }),
    ).not.toBeInTheDocument()

    const question = screen.getByRole("button", {
      name: "Will the test market resolve before the test deadline?",
    })
    expect(question).toHaveClass("text-base")
    const row = question.closest("div") as HTMLElement
    expect(within(row).getByText(/0.1 SOL staked/i)).toHaveClass("tabular")
    const status = within(row).getByText("Open")
    expect(status).toHaveClass("text-xs")
    expect(status).not.toHaveClass("rounded-full")
  })
})
