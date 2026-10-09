import React from "react"
import { fireEvent, render, screen, within } from "@testing-library/react"
import { vi } from "vitest"

import Navbar from "@/components/layout/Navbar"

const controls = vi.hoisted(() => ({
  showPortfolio: vi.fn(),
}))

vi.mock("@/components/providers/MarketProvider", () => ({
  useMarkets: () => ({ showPortfolio: controls.showPortfolio }),
}))

vi.mock("@/components/providers/SolanaProvider", () => ({
  useSolanaWallet: () => ({ connected: true }),
}))

vi.mock("@/components/wallet/WalletConnectButton", () => ({
  default: ({ className = "" }: { className?: string }) => (
    <button type="button" className={className}>
      Connect wallet
    </button>
  ),
}))

describe("Clyma navigation rail", () => {
  it("anchors the new brand in the desktop rail and keeps search interactive", () => {
    const onSearchChange = vi.fn()
    render(<Navbar search="" onSearchChange={onSearchChange} />)

    const navigation = screen.getByRole("navigation", {
      name: /primary navigation/i,
    })
    const homeLink = within(navigation).getByRole("link", {
      name: /clyma climate atlas home/i,
    })

    expect(navigation).toHaveClass("md:w-52")
    expect(homeLink).toHaveClass("md:mt-auto")
    expect(within(homeLink).getByTestId("clyma-mark")).toBeInTheDocument()
    expect(within(homeLink).getByText("Clyma")).toBeInTheDocument()
    expect(screen.queryByText(/klashi/i)).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText(/search climate markets/i), {
      target: { value: "flood" },
    })
    expect(onSearchChange).toHaveBeenCalledWith("flood")

    const positionsButton = within(navigation).getByRole("button", {
      name: /my positions/i,
    })
    fireEvent.click(positionsButton)
    expect(controls.showPortfolio).toHaveBeenCalledOnce()
    expect(
      within(navigation).queryByRole("button", { name: /market desk/i }),
    ).not.toBeInTheDocument()
  })
})
