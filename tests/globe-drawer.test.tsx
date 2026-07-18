import React from "react"
import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { vi } from "vitest"

import ClimateGlobe from "@/components/globe/ClimateGlobe"
import GlobeHero from "@/components/globe/GlobeHero"
import RegionalMarketDrawer from "@/components/markets/RegionalMarketDrawer"
import { GlobeLinkProvider } from "@/components/providers/GlobeLinkProvider"
import {
  MarketProvider,
  useMarkets,
} from "@/components/providers/MarketProvider"
import { demoMarkets } from "@/lib/markets/data"

const { mockConnection } = vi.hoisted(() => ({ mockConnection: {} }))

vi.mock("@/components/providers/SolanaProvider", () => ({
  useSolanaWallet: () => ({ connection: mockConnection }),
}))

vi.mock("@/components/markets/MarketDetails", () => ({
  default: ({ market }: { market: { question: string } }) => (
    <div data-testid="selected-market">{market.question}</div>
  ),
}))

describe("geographic market workflow", () => {
  it("opens a region from the globe's accessible selector", async () => {
    const user = userEvent.setup()
    const onRegionSelect = vi.fn()
    render(
      <ClimateGlobe
        markets={demoMarkets}
        selectedRegion={null}
        onRegionSelect={onRegionSelect}
        onMarketSelect={vi.fn()}
      />,
    )

    await user.selectOptions(
      screen.getByLabelText(/explore markets by region/i),
      "North America",
    )
    expect(onRegionSelect).toHaveBeenCalledWith("North America")
    expect(
      screen.getByRole("button", { name: /reset globe view/i }),
    ).toBeEnabled()
    expect(
      screen.queryByRole("button", { name: /likelihood heat map/i }),
    ).not.toBeInTheDocument()
    expect(screen.queryByText(/live simulation/i)).not.toBeInTheDocument()
    expect(screen.getByRole("img")).toHaveAccessibleName(/halftone globe/i)
  })

  it("filters markets by selected continent and opens an individual market", async () => {
    const user = userEvent.setup()

    function Harness() {
      const { selectRegion } = useMarkets()
      return (
        <>
          <button type="button" onClick={() => selectRegion("Europe")}>
            Open Europe
          </button>
          <RegionalMarketDrawer />
        </>
      )
    }

    render(
      <MarketProvider>
        <Harness />
      </MarketProvider>,
    )

    await user.click(screen.getByRole("button", { name: "Open Europe" }))
    const drawer = screen.getByTestId("market-drawer")
    expect(
      within(drawer).getByRole("heading", { name: "Europe" }),
    ).toBeInTheDocument()
    expect(
      within(drawer).getAllByRole("button", { name: /open market:/i }).length,
    ).toBeGreaterThan(0)
    expect(
      within(drawer).queryByText(/florida experience/i),
    ).not.toBeInTheDocument()

    const europeMarket = demoMarkets.find(
      (market) =>
        market.continent === "Europe" && market.category === "temperature",
    )
    expect(europeMarket).toBeDefined()
    await user.type(
      within(drawer).getByLabelText(/search within europe/i),
      "Paris",
    )
    const parisMarketButton = within(drawer).getByRole("button", {
      name: /open market:.*paris/i,
    })
    expect(parisMarketButton).toHaveAccessibleName(/hazard type temperature/i)
    await user.click(parisMarketButton)
    expect(within(drawer).getByTestId("selected-market")).toHaveTextContent(
      europeMarket!.question,
    )
  })

  it("reserves the drawer width in the globe viewport after selecting a market", async () => {
    const user = userEvent.setup()
    const market = demoMarkets.find((item) => item.status === "open")!

    function Harness() {
      const { selectMarket } = useMarkets()
      return (
        <>
          <button type="button" onClick={() => selectMarket(market)}>
            Select market
          </button>
          <GlobeHero />
        </>
      )
    }

    render(
      <MarketProvider>
        <GlobeLinkProvider>
          <Harness />
        </GlobeLinkProvider>
      </MarketProvider>,
    )

    expect(screen.getByTestId("globe-viewport")).not.toHaveClass(
      "lg:right-[484px]",
    )
    await user.click(screen.getByRole("button", { name: "Select market" }))
    expect(screen.getByTestId("globe-viewport")).toHaveClass("lg:right-[484px]")
  })
})
