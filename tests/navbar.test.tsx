import React from "react"
import { fireEvent, render, screen, within } from "@testing-library/react"
import { vi } from "vitest"

import Navbar from "@/components/layout/Navbar"

vi.mock("@/components/wallet/WalletBalance", () => ({
  default: ({ className = "" }: { className?: string }) => (
    <span className={className}>Wallet balance</span>
  ),
}))

vi.mock("@/components/wallet/WalletConnectButton", () => ({
  default: ({ className = "" }: { className?: string }) => (
    <button type="button" className={className}>
      Connect wallet
    </button>
  ),
}))

describe("TerraForm navigation rail", () => {
  it("anchors the new brand in the desktop rail and keeps search interactive", () => {
    const onSearchChange = vi.fn()
    const onMarketDeskOpen = vi.fn()
    render(
      <Navbar
        search=""
        onSearchChange={onSearchChange}
        isMarketDeskOpen={false}
        onMarketDeskOpen={onMarketDeskOpen}
      />,
    )

    const navigation = screen.getByRole("navigation", {
      name: /primary navigation/i,
    })
    const homeLink = within(navigation).getByRole("link", {
      name: /terraform climate atlas home/i,
    })

    expect(navigation).toHaveClass("md:w-64")
    expect(homeLink).toHaveClass("md:mt-auto")
    expect(within(homeLink).getByTestId("terraform-mark")).toBeInTheDocument()
    expect(within(homeLink).getByText("TerraForm")).toBeInTheDocument()
    expect(screen.queryByText(/klashi/i)).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText(/search climate markets/i), {
      target: { value: "flood" },
    })
    expect(onSearchChange).toHaveBeenCalledWith("flood")

    const marketDeskButton = within(navigation).getByRole("button", {
      name: /market desk/i,
    })
    expect(marketDeskButton).toHaveAttribute("aria-expanded", "false")
    fireEvent.click(marketDeskButton)
    expect(onMarketDeskOpen).toHaveBeenCalledOnce()
  })
})
