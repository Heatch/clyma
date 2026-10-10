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
    clusterMarkets,
    isDrawerOpen,
    isPortfolioMode,
    detailReturnView,
    selectMarket,
    showRegionMarkets,
    showClusterMarkets,
    showPortfolio,
    closeDrawer,
  } = useMarkets()
  const [search, setSearch] = useState("")
  const [category, setCategory] = useState<MarketCategory | "all">("all")
  const drawerRef = useRef<HTMLElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!isDrawerOpen) return
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null
    const frame = window.requestAnimationFrame(() => {
      closeButtonRef.current?.focus({ preventScroll: true })
    })
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault()
        closeDrawer()
        return
      }
      if (event.key !== "Tab" || !drawerRef.current) return
      const focusable = [
        ...drawerRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ].filter((element) => !element.closest("[hidden]"))
      const first = focusable[0]
      const last = focusable.at(-1)
      if (!first || !last) return
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener("keydown", handleKeyDown)
    return () => {
      window.cancelAnimationFrame(frame)
      document.removeEventListener("keydown", handleKeyDown)
      if (previousFocusRef.current?.isConnected) {
        previousFocusRef.current.focus({ preventScroll: true })
      } else {
        document
          .querySelector<HTMLElement>('canvas[aria-label^="Interactive"]')
          ?.focus({ preventScroll: true })
      }
    }
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

  const shouldShowPortfolio =
    isPortfolioMode ||
    (!selectedMarket && !selectedRegion && !clusterMarkets && isDrawerOpen)

  if (!isDrawerOpen) return null
  if (!shouldShowPortfolio && !selectedRegion && !clusterMarkets) return null

  const clusterHeadline = clusterMarkets?.[0]
  const backAction =
    detailReturnView === "portfolio"
      ? showPortfolio
      : detailReturnView === "cluster"
        ? showClusterMarkets
        : showRegionMarkets
  const backLabel =
    detailReturnView === "portfolio"
      ? "Back to positions"
      : detailReturnView === "cluster"
        ? "Back to nearby markets"
        : "Back to region markets"

  return (
    <>
      <button
        type="button"
        className="fixed inset-0 z-40 cursor-default bg-black/60 backdrop-blur-[3px] md:hidden"
        aria-label="Close market panel"
        onClick={closeDrawer}
      />
      <aside
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-label={
          isPortfolioMode
            ? "My Positions"
            : selectedMarket
              ? `Market details: ${selectedMarket.question}`
              : clusterMarkets
                ? `${clusterMarkets.length} nearby markets`
                : `${selectedRegion} markets`
        }
        data-testid="market-drawer"
        className="fixed inset-x-0 bottom-0 z-50 max-h-[88dvh] overflow-hidden rounded-t-[1.75rem] border border-white/15 bg-[#0b0d0f]/95 text-white shadow-[0_24px_90px_rgba(0,0,0,0.55)] backdrop-blur-2xl md:inset-y-0 md:bottom-0 md:left-auto md:right-0 md:top-0 md:max-h-none md:w-[var(--drawer-width)] md:rounded-none md:border-y-0 md:border-r-0 md:shadow-none"
      >
        <div className="flex h-full min-h-0 flex-col">
          <div
            className="flex justify-center py-2 md:hidden"
            aria-hidden="true"
          >
            <span className="h-1 w-10 rounded-full bg-white/25" />
          </div>
          <div className="flex shrink-0 items-center justify-between px-4 py-3 sm:px-5">
            {selectedMarket ? (
              <button
                type="button"
                onClick={backAction}
                className="grid size-9 place-items-center text-xl text-neutral-300 transition hover:text-white"
                aria-label={backLabel}
              >
                ‹
              </button>
            ) : (
              <span aria-hidden="true" className="size-9" />
            )}
            <button
              ref={closeButtonRef}
              type="button"
              onClick={closeDrawer}
              className="grid size-9 place-items-center text-xl text-neutral-300 transition hover:text-white"
              aria-label="Close market panel"
            >
              ×
            </button>
          </div>

          <div className="scrollbar-none min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 sm:p-5">
            {shouldShowPortfolio ? (
              <PortfolioPanel />
            ) : selectedMarket ? (
              <MarketDetails market={selectedMarket} />
            ) : clusterMarkets ? (
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-neutral-400">
                  Overlapping signals
                </p>
                <div className="mt-1 flex items-end justify-between gap-4">
                  <h2 className="text-2xl font-semibold tracking-[-0.03em]">
                    {clusterMarkets.length} nearby markets
                  </h2>
                  <span className="text-[10px] font-semibold text-neutral-400">
                    {clusterHeadline?.region}
                  </span>
                </div>
                <p className="mt-2 max-w-md text-xs leading-5 text-neutral-400">
                  These markets share this spot on the globe.
                </p>

                <div
                  className="mt-5 space-y-3"
                  data-testid="cluster-market-list"
                >
                  {clusterMarkets.map((market) => (
                    <MarketListItem
                      key={market.id}
                      market={market}
                      onSelect={(selected) => selectMarket(selected, "cluster")}
                      tone="dark"
                    />
                  ))}
                </div>
              </div>
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
                  Browse climate-risk markets mapped to this region.
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
