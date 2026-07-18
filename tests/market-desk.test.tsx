import React, { useState } from "react"
import { fireEvent, render, screen } from "@testing-library/react"
import { vi } from "vitest"

import MarketDeskDrawer from "@/components/markets/MarketDeskDrawer"

vi.mock("@/components/markets/TrendingMarkets", () => ({
  default: () => <section>Trending market content</section>,
}))

vi.mock("@/components/portfolio/PortfolioPanel", () => ({
  default: () => <section>Portfolio content</section>,
}))

vi.mock("@/components/providers/MarketProvider", () => ({
  useMarkets: () => ({ isDrawerOpen: false }),
}))

function MarketDeskHarness() {
  const [isOpen, setIsOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setIsOpen(true)}>
        Launch desk
      </button>
      <MarketDeskDrawer isOpen={isOpen} onClose={() => setIsOpen(false)} />
    </>
  )
}

describe("Market desk drawer", () => {
  it("switches sections using accessible tabs", () => {
    render(<MarketDeskHarness />)
    fireEvent.click(screen.getByRole("button", { name: /launch desk/i }))

    expect(
      screen.getByRole("dialog", { name: /market desk/i }),
    ).toBeInTheDocument()
    expect(screen.getByText("Trending market content")).toBeVisible()

    fireEvent.click(screen.getByRole("tab", { name: /portfolio/i }))
    expect(screen.getByRole("tab", { name: /portfolio/i })).toHaveAttribute(
      "aria-selected",
      "true",
    )
    expect(screen.getByText("Portfolio content")).toBeVisible()
    expect(screen.getByText("Trending market content")).not.toBeVisible()
  })

  it("traps focus, closes with Escape, and restores the launch button", () => {
    render(<MarketDeskHarness />)
    const launchButton = screen.getByRole("button", { name: /launch desk/i })
    launchButton.focus()
    fireEvent.click(launchButton)

    const closeButton = screen.getByRole("button", {
      name: /close market desk/i,
    })
    expect(closeButton).toHaveFocus()

    fireEvent.keyDown(document, { key: "Tab", shiftKey: true })
    expect(screen.getByRole("tab", { name: /trending/i })).toHaveFocus()

    fireEvent.keyDown(document, { key: "Escape" })
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    expect(launchButton).toHaveFocus()
  })

  it("closes from the backdrop", () => {
    render(<MarketDeskHarness />)
    fireEvent.click(screen.getByRole("button", { name: /launch desk/i }))
    fireEvent.click(
      screen.getByRole("button", { name: /dismiss market desk/i }),
    )
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })
})
