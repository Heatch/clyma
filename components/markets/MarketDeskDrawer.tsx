"use client"

import { useEffect, useRef, useState } from "react"

import TrendingMarkets from "@/components/markets/TrendingMarkets"
import PortfolioPanel from "@/components/portfolio/PortfolioPanel"
import { useMarkets } from "@/components/providers/MarketProvider"

type DeskView = "markets" | "portfolio"

interface MarketDeskDrawerProps {
  isOpen: boolean
  onClose: () => void
}

const FOCUSABLE_SELECTOR = [
  'a[href]:not([tabindex="-1"])',
  'button:not([disabled]):not([tabindex="-1"])',
  'input:not([disabled]):not([tabindex="-1"])',
  'select:not([disabled]):not([tabindex="-1"])',
  'textarea:not([disabled]):not([tabindex="-1"])',
  '[tabindex]:not([tabindex="-1"])',
].join(",")

export default function MarketDeskDrawer({
  isOpen,
  onClose,
}: MarketDeskDrawerProps) {
  const { isDrawerOpen } = useMarkets()
  const [activeView, setActiveView] = useState<DeskView>("markets")
  const dialogRef = useRef<HTMLElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)
  const isDrawerHandoffRef = useRef(false)

  useEffect(() => {
    if (!isOpen) return

    isDrawerHandoffRef.current = false
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null
    closeButtonRef.current?.focus({ preventScroll: true })

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key !== "Tab") return

      const focusable = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) ??
          [],
      ).filter(
        (element) =>
          element.getAttribute("aria-hidden") !== "true" &&
          !element.closest("[hidden]"),
      )
      if (focusable.length === 0) return

      const first = focusable[0]
      const last = focusable[focusable.length - 1]
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
      document.removeEventListener("keydown", handleKeyDown)
      if (!isDrawerHandoffRef.current) {
        previousFocusRef.current?.focus({ preventScroll: true })
      }
    }
  }, [isOpen, onClose])

  // Choosing a market opens the regional market drawer. Hand the interface
  // over to that drawer instead of stacking two modal surfaces.
  useEffect(() => {
    if (isOpen && isDrawerOpen) {
      isDrawerHandoffRef.current = true
      onClose()
    }
  }, [isDrawerOpen, isOpen, onClose])

  if (!isOpen) return null

  const selectView = (view: DeskView) => setActiveView(view)

  const handleTabKeyDown = (event: React.KeyboardEvent, view: DeskView) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return
    event.preventDefault()
    const nextView: DeskView = view === "markets" ? "portfolio" : "markets"
    setActiveView(nextView)
    document.getElementById(`market-desk-${nextView}-tab`)?.focus()
  }

  return (
    <div className="pointer-events-none fixed inset-0 z-[70]">
      <button
        type="button"
        tabIndex={-1}
        aria-label="Dismiss market desk"
        className="pointer-events-auto absolute inset-0 cursor-default bg-black/65 backdrop-blur-[3px]"
        onClick={onClose}
      />
      <aside
        ref={dialogRef}
        id="market-desk-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="market-desk-heading"
        className="pointer-events-auto absolute inset-x-0 bottom-0 flex max-h-[92dvh] flex-col overflow-hidden rounded-t-[1.75rem] border border-white/15 bg-[#080b0a]/95 text-white shadow-[0_24px_90px_rgba(0,0,0,0.62)] backdrop-blur-2xl sm:inset-y-3 sm:left-auto sm:right-3 sm:max-h-none sm:w-[min(580px,calc(100vw-1.5rem))] sm:rounded-[1.5rem] lg:inset-y-5 lg:right-5"
      >
        <div className="flex justify-center py-2 sm:hidden" aria-hidden="true">
          <span className="h-1 w-10 rounded-full bg-white/25" />
        </div>

        <header className="shrink-0 border-b border-white/10 px-4 pb-3 pt-2 sm:px-5 sm:pt-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-white/45">
                TerraForm / Devnet
              </p>
              <h2
                id="market-desk-heading"
                className="mt-1 text-lg font-semibold tracking-[-0.025em]"
              >
                Market desk
              </h2>
            </div>
            <button
              ref={closeButtonRef}
              type="button"
              onClick={onClose}
              className="grid size-9 shrink-0 place-items-center rounded-full border border-white/15 bg-white/[0.06] text-lg text-white/70 transition hover:border-white/40 hover:bg-white hover:text-neutral-950"
              aria-label="Close market desk"
            >
              ×
            </button>
          </div>

          <div
            role="tablist"
            aria-label="Market desk sections"
            className="mt-4 grid grid-cols-2 rounded-xl border border-white/10 bg-black/30 p-1"
          >
            {(["markets", "portfolio"] as const).map((view) => {
              const selected = activeView === view
              const label = view === "markets" ? "Trending" : "Portfolio"
              return (
                <button
                  key={view}
                  id={`market-desk-${view}-tab`}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  aria-controls={`market-desk-${view}-panel`}
                  tabIndex={selected ? 0 : -1}
                  onClick={() => selectView(view)}
                  onKeyDown={(event) => handleTabKeyDown(event, view)}
                  className={`rounded-lg px-3 py-2 text-[10px] font-bold uppercase tracking-[0.14em] transition ${
                    selected
                      ? "bg-white text-neutral-950"
                      : "text-white/50 hover:bg-white/[0.06] hover:text-white"
                  }`}
                >
                  {label}
                </button>
              )
            })}
          </div>
        </header>

        <div className="scrollbar-none min-h-0 flex-1 overflow-y-auto overscroll-contain bg-[#f4f4f0] p-4 text-neutral-950 sm:p-5">
          <div
            id="market-desk-markets-panel"
            role="tabpanel"
            aria-labelledby="market-desk-markets-tab"
            hidden={activeView !== "markets"}
            className="[&>section>div:nth-child(2)]:!grid-cols-1"
          >
            <TrendingMarkets />
          </div>
          <div
            id="market-desk-portfolio-panel"
            role="tabpanel"
            aria-labelledby="market-desk-portfolio-tab"
            hidden={activeView !== "portfolio"}
          >
            <PortfolioPanel />
          </div>
        </div>
      </aside>
    </div>
  )
}
