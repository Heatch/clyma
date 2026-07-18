"use client"

import { useEffect, useMemo, useRef, useState } from "react"

import MarketDetails from "@/components/markets/MarketDetails"
import MarketFilters from "@/components/markets/MarketFilters"
import MarketListItem from "@/components/markets/MarketListItem"
import PortfolioPanel from "@/components/portfolio/PortfolioPanel"
import { useMarkets } from "@/components/providers/MarketProvider"
import type { MarketCategory } from "@/lib/markets/types"

export default function RegionalMarketDrawer() {
  const {
    markets,
    selectedRegion,
    selectedMarket,
    isDrawerOpen,
    isPortfolioMode,
    selectMarket,
    showRegionMarkets,
    closeDrawer,
  } = useMarkets()
  const [search, setSearch] = useState("")
  const [category, setCategory] = useState<MarketCategory | "all">("all")
  const closeButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!isDrawerOpen) return
    if (window.matchMedia("(max-width: 767px)").matches) {
      closeButtonRef.current?.focus({ preventScroll: true })
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeDrawer()
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [closeDrawer, isDrawerOpen])

  useEffect(() => {
    setSearch("")
    setCategory("all")
  }, [selectedRegion])

  const regionMarkets = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase()
    return markets.filter(
      (market) =>
        market.continent === selectedRegion &&
        (category === "all" || market.category === category) &&
        (!normalizedSearch ||
          `${market.question} ${market.region} ${market.category}`
            .toLocaleLowerCase()
            .includes(normalizedSearch)),
    )
  }, [category, markets, search, selectedRegion])

  if (!isDrawerOpen) return null
  if (!isPortfolioMode && !selectedRegion) return null

  const activeCount = selectedRegion
    ? markets.filter(
        (market) => market.continent === selectedRegion && market.status === "open",
      ).length
    : 0

  return (
    <>
      <button
        type="button"
        className="fixed inset-0 z-40 cursor-default bg-black/60 backdrop-blur-[3px] md:hidden"
        aria-label="Close market panel"
        onClick={closeDrawer}
      />
      <aside
        aria-label={
          selectedMarket
            ? `Market details: ${selectedMarket.question}`
            : `${selectedRegion} markets`
        }
        data-testid="market-drawer"
        className="fixed inset-x-0 bottom-0 z-50 max-h-[88dvh] overflow-hidden rounded-t-[1.75rem] border border-white/15 bg-[#0b0d0f]/95 text-white shadow-[0_24px_90px_rgba(0,0,0,0.55)] backdrop-blur-2xl md:inset-y-20 md:left-auto md:right-4 md:max-h-none md:w-[min(460px,calc(100vw-2rem))] md:rounded-[1.5rem] lg:right-6"
      >
        <div className="flex h-full min-h-0 flex-col">
          <div
            className="flex justify-center py-2 md:hidden"
            aria-hidden="true"
          >
            <span className="h-1 w-10 rounded-full bg-white/25" />
          </div>
          <div className="flex shrink-0 items-center justify-between border-b border-white/10 bg-black/20 px-4 py-3 sm:px-5">
            <div className="flex min-w-0 items-center gap-3">
              <span
                className="hidden size-2 rounded-full bg-emerald-400 shadow-[0_0_14px_rgba(52,211,153,0.75)] sm:block"
                aria-hidden="true"
              />
              <div className="min-w-0">
                <p className="truncate text-xs font-bold">
                  {isPortfolioMode
                    ? "My Positions"
                    : selectedMarket
                      ? selectedMarket.region
                      : selectedRegion}
                </p>
                <p className="mt-0.5 text-[9px] font-bold uppercase tracking-wider text-neutral-400">
                  {isPortfolioMode
                    ? "Your Devnet holdings"
                    : `${activeCount} active demo market${activeCount === 1 ? "" : "s"} · Devnet`}
                </p>
              </div>
            </div>
            <button
              ref={closeButtonRef}
              type="button"
              onClick={closeDrawer}
              className="grid size-9 shrink-0 place-items-center rounded-full border border-white/15 bg-white/[0.06] text-lg text-neutral-300 transition hover:border-white/40 hover:bg-white hover:text-neutral-950"
              aria-label="Close market panel"
            >
              ×
            </button>
          </div>

          <div className="scrollbar-none min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 sm:p-5">
            {isPortfolioMode ? (
              <PortfolioPanel />
            ) : selectedMarket ? (
              <MarketDetails
                market={selectedMarket}
                onBack={showRegionMarkets}
              />
            ) : (
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-neutral-400">
                  Regional desk
                </p>
                <div className="mt-1 flex items-end justify-between gap-4">
                  <h2 className="text-2xl font-semibold tracking-[-0.03em]">
                    {selectedRegion}
                  </h2>
                  <span className="text-[10px] font-semibold text-neutral-400">
                    {regionMarkets.length} shown
                  </span>
                </div>
                <p className="mt-2 max-w-md text-xs leading-5 text-neutral-400">
                  Browse fictional climate-risk markets mapped to this region.
                  Pool and chart values are sample data.
                </p>

                <label className="mt-5 block" htmlFor="region-market-search">
                  <span className="sr-only">
                    Search within {selectedRegion}
                  </span>
                  <input
                    id="region-market-search"
                    type="search"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder={`Search ${selectedRegion}`}
                    className="h-10 w-full rounded-full border border-white/15 bg-white/[0.06] px-4 text-xs text-white outline-none transition placeholder:text-neutral-500 hover:border-white/30 focus:border-white/60 focus:ring-1 focus:ring-white/40"
                  />
                </label>
                <div className="mt-3">
                  <MarketFilters
                    compact
                    tone="dark"
                    value={category}
                    onChange={setCategory}
                  />
                </div>

                <div
                  className="mt-5 space-y-3"
                  data-testid="regional-market-list"
                >
                  {regionMarkets.map((market) => (
                    <MarketListItem
                      key={market.id}
                      market={market}
                      onSelect={selectMarket}
                      tone="dark"
                    />
                  ))}
                  {regionMarkets.length === 0 && (
                    <div className="rounded-2xl border border-dashed border-white/20 bg-white/[0.03] px-5 py-12 text-center">
                      <p className="text-sm font-semibold">
                        No matching markets
                      </p>
                      <p className="mt-1 text-xs text-neutral-400">
                        Try a different risk category or search phrase.
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          setSearch("")
                          setCategory("all")
                        }}
                        className="mt-4 rounded-full border border-white/25 px-3 py-1.5 text-[11px] font-bold transition hover:border-white hover:bg-white hover:text-neutral-950"
                      >
                        Clear filters
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </aside>
    </>
  )
}
