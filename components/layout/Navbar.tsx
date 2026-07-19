"use client"

import { useCallback } from "react"
import { useMarkets } from "@/components/providers/MarketProvider"
import { useSolanaWallet } from "@/components/providers/SolanaProvider"
import WalletConnectButton from "@/components/wallet/WalletConnectButton"
import { SOLANA_CONFIG_WARNING, SOLANA_PROGRAM_ID } from "@/lib/solana/config"
import TerraFormMark from "@/components/ui/TerraFormMark"

interface NavbarProps {
  search: string
  onSearchChange: (value: string) => void
  isDemo?: boolean
}

export default function Navbar({
  search,
  onSearchChange,
  isDemo = false,
}: NavbarProps) {
  const { showPortfolio } = useMarkets()
  const { connected } = useSolanaWallet()

  const toggleDemo = useCallback(() => {
    if (isDemo) {
      document.cookie = "demo=;path=/;max-age=0"
    } else {
      document.cookie = "demo=1;path=/;max-age=31536000"
    }
    window.location.reload()
  }, [isDemo])

  return (
    <nav
      aria-label="Primary navigation"
      className="pointer-events-none absolute inset-x-0 top-0 z-40 border-b border-white/10 bg-gradient-to-b from-black/95 via-black/75 to-transparent px-4 pb-4 pt-[max(0.875rem,env(safe-area-inset-top))] sm:px-6 md:inset-y-0 md:left-0 md:right-auto md:w-52 md:border-b-0 md:border-r md:bg-[#040706]/95 md:bg-none md:px-4 md:pb-[max(1rem,env(safe-area-inset-bottom))] md:pt-[max(1rem,env(safe-area-inset-top))]"
    >
      <div className="flex h-10 items-center gap-3 md:h-full md:w-full md:flex-col md:items-stretch md:gap-3">
        <a
          href="#top"
          className="group pointer-events-auto order-1 flex shrink-0 items-center gap-2.5 md:order-3 md:mt-auto md:w-full md:border-t md:border-white/10 md:pt-4"
          aria-label="TerraForm climate atlas home"
        >
          <span className="grid size-9 place-items-center text-white/85 transition-colors group-hover:text-white">
            <TerraFormMark data-testid="terraform-mark" className="size-full" />
          </span>
          <span>
            <span className="block text-sm font-semibold leading-none tracking-[-0.02em] text-white">
              TerraForm
            </span>
            <span className="mt-1 block font-mono text-[7px] uppercase tracking-[0.16em] text-white/40">
              Climate signal atlas
            </span>
          </span>
        </a>

        <div className="pointer-events-auto relative order-2 hidden w-full md:order-1 md:block">
          <label htmlFor="market-search" className="sr-only">
            Search climate markets
          </label>
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-white/35"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.8-3.8" />
          </svg>
          <input
            id="market-search"
            type="search"
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Search place, hazard, or market"
            className="h-10 w-full rounded-xl border border-white/15 bg-white/[0.07] pl-9 pr-3 text-[11px] text-white outline-none transition-[border-color,background-color,box-shadow] placeholder:text-white/30 hover:border-white/30 hover:bg-white/10 focus:border-white/50 focus:bg-black/75 focus:ring-2 focus:ring-white/15"
          />
        </div>

        <div className="pointer-events-auto order-3 ml-auto flex shrink-0 items-center gap-2.5 md:order-2 md:ml-0 md:w-full md:flex-col md:items-stretch md:gap-3">
          <button
            type="button"
            onClick={toggleDemo}
            className={`hidden w-full items-center justify-center gap-2 rounded-xl border px-3 py-2 text-center font-mono text-[9px] uppercase tracking-[0.14em] transition md:flex ${
              isDemo
                ? "border-amber-300/30 bg-amber-300/10 text-amber-200"
                : "border-white/10 bg-white/[0.04] text-white/60"
            }`}
          >
            <span
              className={`size-1.5 rounded-full ${
                isDemo ? "bg-amber-300" : "bg-emerald-400 soft-pulse"
              }`}
            />
            {isDemo ? "Demo mode" : "Prod mode"}
          </button>
          <div
            className="hidden w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-2.5 py-2 text-center font-mono text-[9px] uppercase tracking-[0.1em] text-white/60 md:flex"
            title={
              SOLANA_CONFIG_WARNING ??
              (SOLANA_PROGRAM_ID
                ? "A program address is configured; individual market accounts are verified separately."
                : "Set NEXT_PUBLIC_PROGRAM_ID after deploying and initializing the Devnet program.")
            }
            aria-live="polite"
          >
            <span
              className={`size-1.5 rounded-full ${
                SOLANA_PROGRAM_ID ? "soft-pulse bg-emerald-400" : "bg-amber-300"
              }`}
            />
            Devnet · {SOLANA_PROGRAM_ID ? "Program configured" : "Demo only"}
          </div>
          {connected && (
            <button
              type="button"
              onClick={showPortfolio}
              className="rounded-full border border-white/20 bg-white/[0.08] px-4 py-2 text-xs font-semibold text-white transition hover:border-white/40 hover:bg-white/15 md:w-full"
            >
              My Positions
            </button>
          )}
          <WalletConnectButton className="md:w-full" />
        </div>
      </div>
    </nav>
  )
}
