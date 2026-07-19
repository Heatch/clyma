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
import type { ClimateMarket } from "@/lib/markets/types"

const testMarkets: ClimateMarket[] = [
  {
    id: "test-fl-hurricane",
    onchainMarketId: 1001,
    question: "Will Florida record a Category 4+ hurricane landfall before October 31, 2026?",
    slug: "fl-test",
    description: "Test market.",
    category: "hurricane",
    continent: "North America",
    country: "United States",
    region: "Florida",
    latitude: 27.6648,
    longitude: -81.5158,
    closeTime: "2099-12-31T23:59:59.000Z",
    resolutionTime: "2100-01-14T18:00:00.000Z",
    status: "open",
    outcome: "unresolved",
    yesPrice: 0.43,
    noPrice: 0.57,
    yesLiquidity: 430,
    noLiquidity: 570,
    totalVolume: 2840,
    participants: 184,
    resolutionSource: "NOAA",
    resolutionSourceUrl: "https://www.nhc.noaa.gov/",
    resolutionRules: "Resolve YES if hurricane landfall.",
    resolver: "3mshx6HoZop71xQ483kLMdiUuXQ1UxDgBABuLnFkVfDV",
    createdAt: "2026-05-01T14:00:00.000Z",
    featured: true,
    trendingScore: 96,
    history: [],
    evidence: [],
    recentTrades: [],
    network: "devnet",
    settlementAsset: "SOL",
    marketModel: "pooled-binary",
    isDemo: false,
    dataLabel: "",
    dataDisclaimer: "",
  },
  {
    id: "test-europe-heatwave",
    onchainMarketId: 1004,
    question: "Will Paris, Madrid, or Rome record 40°C before September 30, 2026?",
    slug: "europe-heatwave",
    description: "Test market.",
    category: "temperature",
    continent: "Europe",
    region: "Paris–Madrid–Rome",
    latitude: 44.5,
    longitude: 5.5,
    closeTime: "2099-12-31T23:59:59.000Z",
    resolutionTime: "2100-01-14T18:00:00.000Z",
    status: "open",
    outcome: "unresolved",
    yesPrice: 0.58,
    noPrice: 0.42,
    yesLiquidity: 696,
    noLiquidity: 504,
    totalVolume: 4310,
    participants: 278,
    resolutionSource: "WMO",
    resolutionSourceUrl: "https://climatedata-catalogue-wmo.org/",
    resolutionRules: "Resolve YES if 40°C recorded.",
    resolver: "3mshx6HoZop71xQ483kLMdiUuXQ1UxDgBABuLnFkVfDV",
    createdAt: "2026-05-10T14:00:00.000Z",
    featured: true,
    trendingScore: 94,
    history: [],
    evidence: [],
    recentTrades: [],
    network: "devnet",
    settlementAsset: "SOL",
    marketModel: "pooled-binary",
    isDemo: false,
    dataLabel: "",
    dataDisclaimer: "",
  },
  {
    id: "test-queensland-cyclone",
    onchainMarketId: 1023,
    question: "Will a tropical cyclone cross the Queensland coast before March 31, 2027?",
    slug: "queensland-cyclone",
    description: "Test market.",
    category: "hurricane",
    continent: "Oceania",
    country: "Australia",
    region: "Queensland",
    latitude: -19.26,
    longitude: 146.82,
    closeTime: "2099-12-31T23:59:59.000Z",
    resolutionTime: "2100-01-14T18:00:00.000Z",
    status: "open",
    outcome: "unresolved",
    yesPrice: 0.62,
    noPrice: 0.38,
    yesLiquidity: 620,
    noLiquidity: 380,
    totalVolume: 2720,
    participants: 173,
    resolutionSource: "BOM",
    resolutionSourceUrl: "http://www.bom.gov.au/cyclone/",
    resolutionRules: "Resolve YES if cyclone crosses coast.",
    resolver: "3mshx6HoZop71xQ483kLMdiUuXQ1UxDgBABuLnFkVfDV",
    createdAt: "2026-06-16T14:00:00.000Z",
    featured: false,
    trendingScore: 78,
    history: [],
    evidence: [],
    recentTrades: [],
    network: "devnet",
    settlementAsset: "SOL",
    marketModel: "pooled-binary",
    isDemo: false,
    dataLabel: "",
    dataDisclaimer: "",
  },
]

const { mockConnection } = vi.hoisted(() => ({ mockConnection: {} }))

vi.mock("@/components/providers/SolanaProvider", () => ({
  useSolanaWallet: () => ({ connection: mockConnection }),
}))

vi.mock("@/components/markets/MarketDetails", () => ({
  default: ({ market }: { market: { question: string } }) => (
    <div data-testid="selected-market">{market.question}</div>
  ),
}))

vi.mock("@/components/portfolio/PortfolioPanel", () => ({
  default: () => <div>Portfolio contents</div>,
}))

describe("geographic market workflow", () => {
  it("opens a region from the globe's accessible selector", async () => {
    const user = userEvent.setup()
    const onRegionSelect = vi.fn()
    render(
      <ClimateGlobe
        markets={testMarkets}
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

    const europeMarket = testMarkets.find(
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

  it("labels the wallet portfolio drawer independently of a region", async () => {
    const user = userEvent.setup()

    function Harness() {
      const { showPortfolio } = useMarkets()
      return (
        <>
          <button type="button" onClick={showPortfolio}>
            Open positions
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

    await user.click(screen.getByRole("button", { name: "Open positions" }))
    expect(
      screen.getByRole("dialog", { name: "My Positions" }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole("dialog", { name: /null markets/i }),
    ).not.toBeInTheDocument()
  })
})
