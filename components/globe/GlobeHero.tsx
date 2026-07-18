"use client"

import ClimateGlobe from "@/components/globe/ClimateGlobe"
import HazardIcon from "@/components/icons/HazardIcon"
import MarketFilters from "@/components/markets/MarketFilters"
import { useMarkets } from "@/components/providers/MarketProvider"
import { CATEGORY_LABELS } from "@/lib/markets/categories"
import type { MarketCategory } from "@/lib/markets/types"

const LEGEND_CATEGORIES: MarketCategory[] = [
  "hurricane",
  "drought",
  "temperature",
  "rainfall",
  "flooding",
  "crop-yield",
  "wildfire",
]

export default function GlobeHero() {
  const {
    visibleMarkets,
    selectedRegion,
    selectedMarket,
    isDrawerOpen,
    search,
    category,
    setSearch,
    setCategory,
    selectRegion,
    selectMarket,
  } = useMarkets()

  const openMarkets = visibleMarkets.filter(
    (market) => market.status === "open",
  )

  return (
    <section
      aria-label="Global climate prediction atlas"
      className="relative h-full min-h-0 w-full overflow-hidden bg-[#030605]"
    >
      <div
        data-testid="globe-viewport"
        className={`absolute inset-y-0 left-0 overflow-hidden ${
          isDrawerOpen ? "right-0 lg:right-[484px]" : "right-0"
        }`}
      >
        <div
          aria-hidden="true"
          className="absolute inset-0 z-0 opacity-45 [background-image:linear-gradient(rgba(255,255,255,0.025)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.025)_1px,transparent_1px)] [background-size:44px_44px]"
        />
        <div
          aria-hidden="true"
          className="absolute inset-0 z-0 bg-[radial-gradient(circle_at_50%_48%,rgba(31,86,68,0.16),transparent_42%),radial-gradient(circle_at_50%_50%,transparent_28%,rgba(0,0,0,0.55)_78%)]"
        />

        <ClimateGlobe
          fullBleed
          className="relative z-10 h-full bg-transparent"
          markets={openMarkets}
          selectedRegion={selectedRegion}
          selectedMarketId={selectedMarket?.id}
          onRegionSelect={selectRegion}
          onMarketSelect={selectMarket}
        />

        <div className="pointer-events-none absolute left-7 top-[94px] z-20 hidden max-w-[245px] xl:block">
          <div className="flex items-center gap-2 font-mono text-[9px] uppercase tracking-[0.18em] text-emerald-300/80">
            <span className="size-1.5 rounded-full bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.8)]" />
            Global risk monitor
          </div>
          <h1 className="mt-3 text-2xl font-medium leading-[1.02] tracking-[-0.045em] text-white lg:text-[2rem]">
            Forecast the world
            <br />
            as it changes.
          </h1>
          <p className="text-white/42 mt-3 max-w-[230px] text-[11px] leading-5">
            Rotate the globe and select a hazard signal to inspect its market,
            probability history, and outcomes.
          </p>
          <div className="mt-5 flex items-center gap-4 border-t border-white/10 pt-3 font-mono text-[9px] uppercase tracking-[0.12em] text-white/35">
            <span>
              <strong className="mr-1 text-sm font-medium text-white/90">
                {openMarkets.length}
              </strong>
              signals
            </span>
            <span>
              <strong className="mr-1 text-sm font-medium text-white/90">
                Devnet
              </strong>
              sample
            </span>
          </div>
        </div>

        <div className="pointer-events-none absolute inset-x-0 top-[76px] z-30 flex justify-center px-3 sm:top-[80px] sm:px-6 md:top-4">
          <div className="pointer-events-auto max-w-[min(100%,760px)] overflow-hidden rounded-full border border-white/10 bg-black/55 px-1.5 py-1 shadow-[0_18px_55px_rgba(0,0,0,0.28)] backdrop-blur-xl">
            <MarketFilters
              compact
              tone="dark"
              value={category}
              onChange={setCategory}
            />
          </div>
        </div>

        <div className="pointer-events-auto absolute inset-x-4 top-[132px] z-30 md:hidden">
          <label htmlFor="mobile-market-search" className="sr-only">
            Search climate markets
          </label>
          <input
            id="mobile-market-search"
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search place or hazard"
            className="h-10 w-full rounded-full border border-white/15 bg-black/60 px-4 text-base text-white outline-none backdrop-blur-xl placeholder:text-white/35 focus:border-white/45 focus:ring-2 focus:ring-white/15"
          />
        </div>

        <div className="pointer-events-none absolute bottom-[86px] left-5 z-20 hidden xl:block">
          <p className="mb-2 font-mono text-[8px] uppercase tracking-[0.18em] text-white/30">
            Hazard index
          </p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
            {LEGEND_CATEGORIES.map((item) => (
              <span
                key={item}
                className="text-white/42 flex items-center gap-2 text-[9px]"
              >
                <span className="grid size-5 place-items-center rounded-md border border-white/10 bg-white/[0.04] text-white/60">
                  <HazardIcon category={item} className="size-4" />
                </span>
                {CATEGORY_LABELS[item]}
              </span>
            ))}
          </div>
        </div>

        <p
          className="pointer-events-none absolute bottom-[90px] left-1/2 z-20 hidden -translate-x-1/2 items-center gap-2 whitespace-nowrap rounded-full border border-white/10 bg-black/45 px-3 py-1.5 font-mono text-[8px] uppercase tracking-[0.14em] text-white/35 backdrop-blur lg:flex"
          aria-live="polite"
        >
          <span className="size-1 rounded-full bg-white/50" />
          {selectedMarket
            ? `${selectedMarket.region} signal selected`
            : "Drag to rotate · Scroll to zoom · Select a signal"}
        </p>
      </div>

      <div className="sr-only" aria-live="polite">
        {openMarkets.length} open market signals shown
        {selectedMarket ? `. Selected ${selectedMarket.question}` : ""}
      </div>
    </section>
  )
}
