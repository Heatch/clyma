import React from "react"
import {
  fireEvent,
  render,
  screen,
  waitForElementToBeRemoved,
  within,
} from "@testing-library/react"
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
import { fixtureMarkets } from "@/lib/markets/data"
import type { ClimateMarket } from "@/lib/markets/types"

const testMarkets: ClimateMarket[] = [
  {
    id: "test-fl-hurricane",
    onchainMarketId: 1001,
    question:
      "Will Florida record a Category 4+ hurricane landfall before October 31, 2026?",
    slug: "fl-test",
    description: "Test market.",
    category: "hurricane",
    continent: "North America",
    country: "United States",
    region: "Florida",
    latitude: 27.6648,
    longitude: -81.5158,
    closeTime: "2099-12-29T23:59:59.000Z",
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
  },
  {
    id: "test-europe-heatwave",
    onchainMarketId: 1004,
    question:
      "Will Paris, Madrid, or Rome record 40°C before September 30, 2026?",
    slug: "europe-heatwave",
    description: "Paris heat and valley conditions shape this outlook.",
    category: "temperature",
    continent: "Europe",
    region: "Paris–Madrid–Rome",
    latitude: 44.5,
    longitude: 5.5,
    closeTime: "2099-12-30T23:59:59.000Z",
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
  },
  {
    id: "test-queensland-cyclone",
    onchainMarketId: 1023,
    question:
      "Will a tropical cyclone cross the Queensland coast before March 31, 2027?",
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
  it("renders the globe without the removed navigation chrome", () => {
    render(
      <ClimateGlobe
        markets={testMarkets}
        selectedRegion={null}
        isDrawerOpen={false}
        onRegionSelect={vi.fn()}
        onMarketSelect={vi.fn()}
        onClusterSelect={vi.fn()}
      />,
    )

    expect(screen.getByRole("img")).toHaveAccessibleName(/halftone globe/i)
    expect(
      screen.queryByLabelText(/explore markets by region/i),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: /reset globe view/i }),
    ).not.toBeInTheDocument()
    expect(screen.queryByText(/drag to rotate/i)).not.toBeInTheDocument()
  })

  it("closes the drawer when empty ocean is clicked", () => {
    const onEmptySelect = vi.fn()
    render(
      <ClimateGlobe
        markets={testMarkets}
        selectedRegion={null}
        isDrawerOpen={false}
        onRegionSelect={vi.fn()}
        onMarketSelect={vi.fn()}
        onClusterSelect={vi.fn()}
        onEmptySelect={onEmptySelect}
      />,
    )

    fireEvent(
      screen.getByRole("img"),
      new MouseEvent("pointerup", {
        bubbles: true,
        cancelable: true,
        clientX: 121.2,
        clientY: 301,
      }),
    )
    expect(onEmptySelect).toHaveBeenCalledTimes(1)
  })

  it("does not close the drawer after a globe drag", () => {
    const onEmptySelect = vi.fn()
    render(
      <ClimateGlobe
        markets={testMarkets}
        selectedRegion={null}
        isDrawerOpen={false}
        onRegionSelect={vi.fn()}
        onMarketSelect={vi.fn()}
        onClusterSelect={vi.fn()}
        onEmptySelect={onEmptySelect}
      />,
    )

    const canvas = screen.getByRole("img")
    Object.defineProperty(canvas, "setPointerCapture", {
      value: vi.fn(),
      configurable: true,
    })
    fireEvent(
      canvas,
      new MouseEvent("pointerdown", {
        bubbles: true,
        cancelable: true,
        clientX: 100,
        clientY: 100,
      }),
    )
    fireEvent(
      canvas,
      new MouseEvent("pointermove", {
        bubbles: true,
        cancelable: true,
        clientX: 200,
        clientY: 100,
      }),
    )
    fireEvent(
      canvas,
      new MouseEvent("pointerup", {
        bubbles: true,
        cancelable: true,
        clientX: 121.2,
        clientY: 301,
      }),
    )
    expect(onEmptySelect).not.toHaveBeenCalled()
  })

  it("spotlights the selected market and dims the other markers", () => {
    render(
      <ClimateGlobe
        markets={testMarkets}
        selectedRegion={null}
        selectedMarketId={testMarkets[0]!.id}
        isDrawerOpen
        onRegionSelect={vi.fn()}
        onMarketSelect={vi.fn()}
        onClusterSelect={vi.fn()}
      />,
    )

    const layer = document.querySelector(".globe-marker-layer")
    expect(layer).toHaveClass("has-selection")
    const spotlight = layer?.querySelector(".globe-spotlight")
    expect(spotlight).toBeInTheDocument()
    expect(
      (spotlight as HTMLElement).style.getPropertyValue("--spotlight-x"),
    ).toContain("px")
    expect(
      (spotlight as HTMLElement).style.getPropertyValue("--spotlight-y"),
    ).toContain("px")
  })

  it("opens the globe region in the central browse view", async () => {
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
      <MarketProvider initialMarkets={testMarkets}>
        <Harness />
      </MarketProvider>,
    )

    await user.click(screen.getByRole("button", { name: "Open Europe" }))
    const drawer = screen.getByTestId("market-drawer")
    expect(
      within(drawer).getByRole("heading", { name: "Search markets" }),
    ).toBeInTheDocument()
    await user.click(
      within(drawer).getByRole("button", { name: /region filter/i }),
    )
    expect(
      within(drawer).getByRole("checkbox", { name: "Europe" }),
    ).toBeChecked()
    // The provider holds 3 markets; only the European market may show.
    expect(
      within(drawer).getAllByRole("button", { name: /open market:/i }),
    ).toHaveLength(1)
    expect(
      within(drawer).queryByText(/florida experience/i),
    ).not.toBeInTheDocument()

    const europeMarket = testMarkets.find(
      (market) =>
        market.continent === "Europe" && market.category === "temperature",
    )
    expect(europeMarket).toBeDefined()
    await user.type(within(drawer).getByLabelText(/search markets/i), "Paris")
    const parisMarketButton = within(drawer).getByRole("button", {
      name: /open market:.*paris/i,
    })
    expect(parisMarketButton).toHaveAccessibleName(/hazard type temperature/i)
    await user.click(parisMarketButton)
    expect(within(drawer).getByTestId("selected-market")).toHaveTextContent(
      europeMarket!.question,
    )

    await user.click(
      within(drawer).getByRole("button", { name: /back to results/i }),
    )
    expect(
      within(drawer).getByRole("heading", { name: "Search markets" }),
    ).toBeInTheDocument()
    expect(
      within(drawer).queryByTestId("selected-market"),
    ).not.toBeInTheDocument()
  })

  it("pins a clicked cluster with a removable scope", async () => {
    const user = userEvent.setup()
    const cluster = testMarkets.slice(0, 2)

    function Harness() {
      const { selectCluster } = useMarkets()
      return (
        <>
          <button type="button" onClick={() => selectCluster(cluster)}>
            Open cluster
          </button>
          <RegionalMarketDrawer />
        </>
      )
    }

    render(
      <MarketProvider initialMarkets={testMarkets}>
        <Harness />
      </MarketProvider>,
    )

    await user.click(screen.getByRole("button", { name: "Open cluster" }))
    const drawer = screen.getByTestId("market-drawer")
    expect(
      within(drawer).getByText("2 markets at this spot"),
    ).toBeInTheDocument()
    // The provider holds 3 markets; only the 2 cluster members may show.
    expect(
      within(drawer).getAllByRole("button", { name: /open market:/i }),
    ).toHaveLength(2)

    await user.click(
      within(drawer).getByRole("button", { name: /remove spot filter/i }),
    )
    expect(
      within(drawer).queryByText("2 markets at this spot"),
    ).not.toBeInTheDocument()
    expect(
      within(drawer).getAllByRole("button", { name: /open market:/i }),
    ).toHaveLength(3)
  })

  it("searches market titles, regions, and market types", async () => {
    const user = userEvent.setup()

    function Harness() {
      const { showBrowse } = useMarkets()
      return (
        <>
          <button type="button" onClick={() => showBrowse()}>
            Browse markets
          </button>
          <RegionalMarketDrawer />
        </>
      )
    }

    render(
      <MarketProvider initialMarkets={testMarkets}>
        <Harness />
      </MarketProvider>,
    )

    await user.click(screen.getByRole("button", { name: "Browse markets" }))
    const drawer = screen.getByTestId("market-drawer")
    const search = within(drawer).getByLabelText(/search markets/i)

    await user.type(search, "Hurricanes")
    expect(
      within(drawer).getAllByRole("button", { name: /open market:/i }),
    ).toHaveLength(2)

    await user.clear(search)
    await user.type(search, "Florida")
    expect(
      within(drawer).getAllByRole("button", { name: /open market:/i }),
    ).toHaveLength(1)
    expect(
      within(drawer).getByRole("button", { name: /open market:/i }),
    ).toHaveAccessibleName(/florida/i)

    await user.clear(search)
    await user.type(search, "valley")
    expect(
      within(drawer).getAllByRole("button", { name: /open market:/i }),
    ).toHaveLength(1)
    expect(
      within(drawer).getByRole("button", { name: /open market:/i }),
    ).toHaveAccessibleName(/paris/i)

    await user.clear(search)
    await user.type(search, "Oceania")
    expect(
      within(drawer).getAllByRole("button", { name: /open market:/i }),
    ).toHaveLength(1)
    expect(
      within(drawer).getByRole("button", { name: /open market:/i }),
    ).toHaveAccessibleName(/queensland/i)
  })

  it("combines market-type and region filters", async () => {
    const user = userEvent.setup()

    function Harness() {
      const { showBrowse } = useMarkets()
      return (
        <>
          <button type="button" onClick={() => showBrowse()}>
            Browse markets
          </button>
          <RegionalMarketDrawer />
        </>
      )
    }

    render(
      <MarketProvider initialMarkets={testMarkets}>
        <Harness />
      </MarketProvider>,
    )

    await user.click(screen.getByRole("button", { name: "Browse markets" }))
    const drawer = screen.getByTestId("market-drawer")

    await user.click(
      within(drawer).getByRole("button", { name: /market type filter/i }),
    )
    await user.click(
      within(drawer).getByRole("checkbox", { name: "Hurricanes" }),
    )
    expect(
      within(drawer).getByRole("button", {
        name: "Market type filter: Hurricanes",
      }),
    ).toBeInTheDocument()
    await user.click(
      within(drawer).getByRole("button", { name: /region filter/i }),
    )
    await user.click(
      await within(drawer).findByRole("checkbox", { name: "Oceania" }),
    )
    const results = within(drawer).getAllByRole("button", {
      name: /open market:/i,
    })
    expect(results).toHaveLength(1)
    expect(results[0]).toHaveAccessibleName(/queensland/i)

    await user.click(within(drawer).getByRole("checkbox", { name: "Oceania" }))
    expect(
      within(drawer).getAllByRole("button", { name: /open market:/i }),
    ).toHaveLength(2)
  })

  it("orders results with the selected sort", async () => {
    const user = userEvent.setup()

    function Harness() {
      const { showBrowse } = useMarkets()
      return (
        <>
          <button type="button" onClick={() => showBrowse()}>
            Browse markets
          </button>
          <RegionalMarketDrawer />
        </>
      )
    }

    render(
      <MarketProvider initialMarkets={testMarkets}>
        <Harness />
      </MarketProvider>,
    )

    await user.click(screen.getByRole("button", { name: "Browse markets" }))
    const drawer = screen.getByTestId("market-drawer")
    await user.selectOptions(within(drawer).getByLabelText(/sort/i), "volume")
    expect(
      within(drawer)
        .getAllByRole("button", { name: /open market:/i })[0]
        ?.getAttribute("aria-label"),
    ).toMatch(/paris/i)

    await user.click(
      within(drawer).getByRole("button", { name: /reverse order/i }),
    )
    expect(
      within(drawer).getByRole("button", { name: /restore order/i }).className,
    ).not.toMatch(/rounded-lg|border|bg-white/)
    expect(
      within(drawer)
        .getAllByRole("button", { name: /open market:/i })[0]
        ?.getAttribute("aria-label"),
    ).toMatch(/queensland/i)
    expect(
      within(drawer).getByRole("button", { name: /restore order/i }),
    ).toBeInTheDocument()

    await user.selectOptions(within(drawer).getByLabelText(/sort/i), "closing")
    expect(within(drawer).getByLabelText(/sort/i)).toHaveValue("closing")
    expect(
      within(drawer).getByRole("button", { name: /reverse order/i }),
    ).toBeInTheDocument()
    expect(
      within(drawer)
        .getAllByRole("button", { name: /open market:/i })[0]
        ?.getAttribute("aria-label"),
    ).toMatch(/florida/i)

    await user.selectOptions(within(drawer).getByLabelText(/sort/i), "yes")
    expect(
      within(drawer)
        .getAllByRole("button", { name: /open market:/i })[0]
        ?.getAttribute("aria-label"),
    ).toMatch(/queensland/i)
  })

  it("opens the central browse view from the globe magnifier", async () => {
    const user = userEvent.setup()

    render(
      <MarketProvider initialMarkets={testMarkets}>
        <GlobeLinkProvider>
          <GlobeHero />
          <RegionalMarketDrawer />
        </GlobeLinkProvider>
      </MarketProvider>,
    )

    await user.click(screen.getByRole("button", { name: /search markets/i }))
    const drawer = screen.getByTestId("market-drawer")
    expect(
      within(drawer).getByRole("heading", { name: "Search markets" }),
    ).toBeInTheDocument()
    expect(
      within(drawer).getAllByRole("button", { name: /open market:/i }),
    ).toHaveLength(3)
  })

  it("reserves the drawer width in the globe viewport after selecting a market", async () => {
    const user = userEvent.setup()
    const market = fixtureMarkets.find((item) => item.status === "open")!

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
      "md:right-[var(--drawer-width)]",
    )
    await user.click(screen.getByRole("button", { name: "Select market" }))
    expect(screen.getByTestId("globe-viewport")).toHaveClass(
      "md:right-[var(--drawer-width)]",
    )
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

  it("slides the drawer out on close while the globe viewport widens first", async () => {
    const user = userEvent.setup()

    function Harness() {
      const { showBrowse } = useMarkets()
      return (
        <>
          <button type="button" onClick={() => showBrowse()}>
            Browse markets
          </button>
          <GlobeHero />
          <RegionalMarketDrawer />
        </>
      )
    }

    render(
      <MarketProvider initialMarkets={testMarkets}>
        <GlobeLinkProvider>
          <Harness />
        </GlobeLinkProvider>
      </MarketProvider>,
    )

    await user.click(screen.getByRole("button", { name: "Browse markets" }))
    const drawer = screen.getByTestId("market-drawer")
    expect(drawer).toHaveAttribute("data-state", "open")
    expect(screen.getByTestId("globe-viewport")).toHaveClass(
      "md:right-[var(--drawer-width)]",
    )

    await user.click(
      within(drawer).getByRole("button", { name: "Close market panel" }),
    )
    // The panel stays mounted in its closing state while the viewport has
    // already widened, so the globe glide and the slide-out stay in sync.
    expect(screen.getByTestId("market-drawer")).toHaveAttribute(
      "data-state",
      "closing",
    )
    expect(screen.getByTestId("globe-viewport")).not.toHaveClass(
      "md:right-[var(--drawer-width)]",
    )
    await waitForElementToBeRemoved(() => screen.queryByTestId("market-drawer"))
  })

  it("cancels the close when the drawer is reopened mid-exit", async () => {
    const user = userEvent.setup()

    function Harness() {
      const { showBrowse } = useMarkets()
      return (
        <>
          <button type="button" onClick={() => showBrowse()}>
            Browse markets
          </button>
          <RegionalMarketDrawer />
        </>
      )
    }

    render(
      <MarketProvider initialMarkets={testMarkets}>
        <Harness />
      </MarketProvider>,
    )

    await user.click(screen.getByRole("button", { name: "Browse markets" }))
    const drawer = screen.getByTestId("market-drawer")
    await user.click(
      within(drawer).getByRole("button", { name: "Close market panel" }),
    )
    expect(screen.getByTestId("market-drawer")).toHaveAttribute(
      "data-state",
      "closing",
    )

    await user.click(screen.getByRole("button", { name: "Browse markets" }))
    expect(screen.getByTestId("market-drawer")).toHaveAttribute(
      "data-state",
      "open",
    )
  })
})
