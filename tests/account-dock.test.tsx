import React from "react"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { vi } from "vitest"

import AccountDock from "@/components/layout/AccountDock"

const dockControls = vi.hoisted(() => ({
  showPortfolio: vi.fn(),
}))

vi.mock("@/components/providers/MarketProvider", () => ({
  useMarkets: () => ({ showPortfolio: dockControls.showPortfolio }),
}))

vi.mock("@/components/providers/PositionProvider", () => ({
  usePositions: () => ({
    positions: [
      { id: "dock-open", status: "open" },
      { id: "dock-claimed", status: "claimed" },
    ],
  }),
}))

vi.mock("@/components/wallet/WalletConnectButton", () => ({
  default: () => <button type="button">Connect wallet</button>,
}))

describe("account dock", () => {
  it("shows wallet access and only counts open positions", async () => {
    const user = userEvent.setup()
    render(<AccountDock />)

    expect(screen.getByTestId("account-dock")).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "Connect wallet" }),
    ).toBeInTheDocument()

    const positionsButton = screen.getByRole("button", {
      name: "Open positions, 1 open position",
    })
    expect(positionsButton).toHaveTextContent("Positions")
    expect(positionsButton).toHaveTextContent("1")

    await user.click(positionsButton)
    expect(dockControls.showPortfolio).toHaveBeenCalledTimes(1)
  })
})
