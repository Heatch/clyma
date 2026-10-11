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
  // Settled-open drives the viewport glide, the drawer slide-out, and the
  // edge seam together: all three share the 520ms easing, so the panel, the
  // globe, and the seam never move out of sync.
  const drawerSettledOpen = isDrawerOpen && !isDrawerClosing

  return (
    <section
      aria-label="Global climate prediction atlas"
      className="relative h-full min-h-0 w-full overflow-hidden bg-[#030605]"
    >
      <div
        data-testid="globe-viewport"
        className={`absolute inset-y-0 left-0 right-0 overflow-hidden transition-[right] duration-[520ms] ease-[cubic-bezier(0.65,0,0.35,1)] motion-reduce:transition-none ${
          drawerSettledOpen ? "md:right-[var(--drawer-width)]" : ""
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
            className="absolute right-3 top-[max(0.75rem,env(safe-area-inset-top))] z-30 grid size-12 place-items-center rounded-full border-2 border-white/25 bg-[#030605] text-white/70 transition hover:border-white/50 hover:text-white"
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
          <div className="mb-3">
            <BrandMark />
          </div>
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

      {/* Drawer seam (desktop only): a hairline that runs down from the
          magnifier ring to the bottom edge — the seam the drawer slides out
          from. Deliberately non-interactive (only the ring is the button):
          aria-hidden + pointer-events-none. Fades with the same 520ms easing
          as the viewport glide and drawer slide, so all three stay
          synchronized. */}
      <div
        aria-hidden="true"
        data-testid="drawer-seam"
        data-state={drawerSettledOpen ? "open" : "closed"}
        className="pointer-events-none absolute bottom-3 right-[35px] top-14 z-20 hidden w-px bg-gradient-to-b from-white/20 via-white/10 to-transparent transition-opacity duration-[520ms] ease-[cubic-bezier(0.65,0,0.35,1)] data-[state=open]:opacity-0 motion-reduce:transition-none md:block"
      />

      <div className="sr-only" aria-live="polite">
        {openMarkets.length} open markets shown
        {selectedMarket ? `. Selected ${selectedMarket.question}` : ""}
      </div>
    </section>
  )
}
