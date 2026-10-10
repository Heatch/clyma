"use client"

import ClimateGlobe from "@/components/globe/ClimateGlobe"
import { useMarkets } from "@/components/providers/MarketProvider"

export default function GlobeHero() {
  const {
    visibleMarkets,
    selectedRegion,
    selectedMarket,
    isDrawerOpen,
    selectRegion,
    selectMarket,
    selectCluster,
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
          isDrawerOpen ? "right-0 md:right-[var(--drawer-width)]" : "right-0"
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
          isDrawerOpen={isDrawerOpen}
          onRegionSelect={selectRegion}
          onMarketSelect={selectMarket}
          onClusterSelect={selectCluster}
        />

        <div className="pointer-events-none absolute left-4 top-[max(1rem,env(safe-area-inset-top))] z-20 max-w-[260px] sm:left-6 sm:top-6">
          <h1 className="text-xl font-medium leading-[1.05] tracking-[-0.04em] text-white lg:text-2xl">
            Forecast the world as it changes.
          </h1>
          <p className="mt-2 flex items-center gap-2 text-xs text-white/55">
            <span
              className="soft-pulse size-1.5 rounded-full bg-emerald-400"
              aria-hidden="true"
            />
            <span>
              <strong className="font-semibold text-white/90">
                {openMarkets.length}
              </strong>{" "}
              markets active on Devnet
            </span>
          </p>
        </div>
      </div>

      <div className="sr-only" aria-live="polite">
        {openMarkets.length} open markets shown
        {selectedMarket ? `. Selected ${selectedMarket.question}` : ""}
      </div>
    </section>
  )
}
