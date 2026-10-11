"use client"

import ClimateGlobe from "@/components/globe/ClimateGlobe"
import BrandMark from "@/components/layout/BrandMark"
import { useMarkets } from "@/components/providers/MarketProvider"

export default function GlobeHero() {
  const {
    markets,
    selectedRegion,
    selectedMarket,
    isDrawerOpen,
    isDrawerClosing,
    selectRegion,
    selectMarket,
    selectCluster,
    showBrowse,
    closeDrawer,
  } = useMarkets()

  const openMarkets = markets.filter((market) => market.status === "open")

  return (
    <section
      aria-label="Global climate prediction atlas"
      className="relative h-full min-h-0 w-full overflow-hidden bg-[#030605]"
    >
      <div
        data-testid="globe-viewport"
        className={`absolute inset-y-0 left-0 right-0 overflow-hidden transition-[right] duration-[520ms] ease-[cubic-bezier(0.65,0,0.35,1)] motion-reduce:transition-none ${
          isDrawerOpen && !isDrawerClosing
            ? "md:right-[var(--drawer-width)]"
            : ""
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
          onEmptySelect={closeDrawer}
        />

        {!isDrawerOpen && (
          <button
            type="button"
            onClick={() => showBrowse()}
            aria-label="Search markets"
            className="absolute right-4 top-[max(1rem,env(safe-area-inset-top))] z-30 grid size-10 place-items-center text-white/70 transition hover:text-white sm:right-6 sm:top-6"
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              className="size-5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            >
              <circle cx="11" cy="11" r="6.5" />
              <path d="m16 16 4.5 4.5" />
            </svg>
          </button>
        )}
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

      {!isDrawerOpen && <BrandMark />}

      <div className="sr-only" aria-live="polite">
        {openMarkets.length} open markets shown
        {selectedMarket ? `. Selected ${selectedMarket.question}` : ""}
      </div>
    </section>
  )
}
