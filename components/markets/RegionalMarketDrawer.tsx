"use client"

import { useCallback, useEffect, useRef } from "react"

import MarketBrowser from "@/components/markets/MarketBrowser"
import MarketDetails from "@/components/markets/MarketDetails"
import PortfolioPanel from "@/components/portfolio/PortfolioPanel"
import { useMarkets } from "@/components/providers/MarketProvider"

function DrawerControlIcon({ path }: { path: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="size-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={path} />
    </svg>
  )
}

export default function RegionalMarketDrawer() {
  const {
    selectedMarket,
    isDrawerOpen,
    isDrawerClosing,
    isPortfolioMode,
    detailReturnView,
    showBrowse,
    showPortfolio,
    closeDrawer,
  } = useMarkets()
  const drawerRef = useRef<HTMLElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)

  const focusGlobeCanvas = () => {
    document
      .querySelector<HTMLElement>('canvas[aria-label^="Interactive"]')
      ?.focus({ preventScroll: true })
  }
  // Closing is animated: move focus out immediately, the provider unmounts
  // the panel once the slide-out finishes.
  const beginClose = useCallback(() => {
    focusGlobeCanvas()
    closeDrawer()
  }, [closeDrawer])

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
        beginClose()
        return
      }
      // While sliding out the panel is leaving: let focus leave with it
      // instead of trapping tab inside.
      if (isDrawerClosing) return
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
  }, [beginClose, isDrawerClosing, isDrawerOpen])

  const shouldShowPortfolio =
    isPortfolioMode ||
    (!selectedMarket && isDrawerOpen && detailReturnView === "portfolio")

  if (!isDrawerOpen) return null

  // entering is handled by the mount keyframe animation (see .drawer-enter);
  // only the exit needs explicit state.
  const drawerState = isDrawerClosing ? "closing" : "open"

  const backAction =
    detailReturnView === "portfolio" ? showPortfolio : () => showBrowse()
  const backLabel =
    detailReturnView === "portfolio" ? "Back to positions" : "Back to results"

  return (
    <>
      <button
        type="button"
        data-state={drawerState}
        className="fixed inset-0 z-40 cursor-default bg-black/60 backdrop-blur-[3px] transition-opacity duration-[520ms] ease-[cubic-bezier(0.65,0,0.35,1)] data-[state=closing]:opacity-0 motion-reduce:transition-none md:hidden"
        aria-label="Close market panel"
        onClick={beginClose}
      />
      <aside
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        data-state={drawerState}
        aria-label={
          isPortfolioMode
            ? "My Positions"
            : selectedMarket
              ? `Market details: ${selectedMarket.question}`
              : "Browse markets"
        }
        data-testid="market-drawer"
        className="drawer-enter fixed inset-x-0 bottom-0 z-50 flex max-h-[88dvh] flex-col overflow-hidden rounded-t-[1.75rem] border border-white/15 bg-[#0b0d0f]/95 text-white shadow-[0_24px_90px_rgba(0,0,0,0.55)] backdrop-blur-2xl transition-[transform,opacity] duration-[520ms] ease-[cubic-bezier(0.65,0,0.35,1)] data-[state=closing]:translate-y-full data-[state=closing]:opacity-0 motion-reduce:transition-none md:inset-y-0 md:bottom-0 md:left-auto md:right-0 md:top-0 md:max-h-none md:w-[var(--drawer-width)] md:rounded-none md:border-y-0 md:border-r-0 md:shadow-none md:data-[state=closing]:translate-x-full md:data-[state=closing]:translate-y-0"
      >
        <div className="flex min-h-0 flex-auto flex-col">
          <div
            className="flex justify-center py-2 md:hidden"
            aria-hidden="true"
          >
            <span className="h-1 w-10 rounded-full bg-white/25" />
          </div>
          <div className="flex shrink-0 items-center justify-between gap-3 px-4 pt-4 sm:px-5 sm:pt-5">
            {selectedMarket ? (
              <button
                type="button"
                onClick={backAction}
                className="grid size-9 place-items-center text-neutral-300 transition hover:text-white"
                aria-label={backLabel}
              >
                <DrawerControlIcon path="M14.5 5.5 8 12l6.5 6.5" />
              </button>
            ) : (
              <h2 className="truncate text-xl font-semibold tracking-[-0.025em]">
                {isPortfolioMode ? "My Positions" : "Search markets"}
              </h2>
            )}
            <button
              ref={closeButtonRef}
              type="button"
              onClick={beginClose}
              className="grid size-9 place-items-center text-neutral-300 transition hover:text-white"
              aria-label="Close market panel"
            >
              <DrawerControlIcon path="M6 6l12 12M18 6 6 18" />
            </button>
          </div>

          <div className="scrollbar-none min-h-0 flex-auto overflow-y-auto overscroll-contain p-4 sm:p-5">
            {shouldShowPortfolio ? (
              <PortfolioPanel />
            ) : selectedMarket ? (
              <MarketDetails market={selectedMarket} />
            ) : (
              <MarketBrowser />
            )}
          </div>
        </div>
      </aside>
    </>
  )
}
