"use client"

import { useMarkets } from "@/components/providers/MarketProvider"
import { useSolanaWallet } from "@/components/providers/SolanaProvider"
import WalletBalance from "@/components/wallet/WalletBalance"
import WalletConnectButton from "@/components/wallet/WalletConnectButton"

interface NavbarProps {
  search: string
  onSearchChange: (value: string) => void
}

export default function Navbar({ search, onSearchChange }: NavbarProps) {
  const { showPortfolio } = useMarkets()
  const { connected } = useSolanaWallet()
  return (
    <header className="pointer-events-none absolute inset-x-0 top-0 z-40 border-b border-white/10 bg-gradient-to-b from-black/90 via-black/65 to-transparent px-4 pb-4 pt-[max(0.875rem,env(safe-area-inset-top))] backdrop-blur-md sm:px-6 lg:px-8">
      <div className="mx-auto flex h-10 max-w-[1800px] items-center gap-3">
        <a
          href="#top"
          className="group pointer-events-auto flex shrink-0 items-center gap-2.5"
          aria-label="Klashi climate atlas home"
        >
          <span className="relative grid size-9 place-items-center rounded-full border border-white/25 bg-white text-xs font-black text-black shadow-[0_0_28px_rgba(255,255,255,0.16)] transition-transform group-hover:rotate-6">
            K
            <span className="absolute -right-0.5 -top-0.5 size-2 rounded-full border border-black bg-emerald-400" />
          </span>
          <span>
            <span className="block text-sm font-semibold leading-none tracking-[-0.02em] text-white">
              KLASHI
            </span>
            <span className="mt-1 block font-mono text-[8px] uppercase tracking-[0.18em] text-white/40">
              Climate signal atlas
            </span>
          </span>
        </a>

        <div className="pointer-events-auto relative mx-auto hidden w-full max-w-md md:block">
          <label htmlFor="market-search" className="sr-only">
            Search climate markets
          </label>
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            className="absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-white/35"
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
            className="h-10 w-full rounded-full border border-white/15 bg-white/[0.07] pl-10 pr-4 text-xs text-white outline-none backdrop-blur-xl transition-[border-color,background-color,box-shadow] placeholder:text-white/30 hover:border-white/30 hover:bg-white/10 focus:border-white/50 focus:bg-black/75 focus:ring-2 focus:ring-white/15"
          />
        </div>

        <div className="pointer-events-auto ml-auto flex shrink-0 items-center gap-2.5">
          {connected && (
            <button
              type="button"
              onClick={showPortfolio}
              className="rounded-full border border-white/20 bg-white/[0.08] px-4 py-2 text-xs font-semibold text-white transition hover:border-white/40 hover:bg-white/15"
            >
              My Positions
            </button>
          )}
          <div className="hidden items-center gap-2 rounded-full border border-white/10 bg-black/35 px-3 py-2 font-mono text-[9px] uppercase tracking-[0.14em] text-white/55 lg:flex">
            <span className="soft-pulse size-1.5 rounded-full bg-emerald-400" />
            Devnet · Sample data
          </div>
          <div className="hidden xl:block">
            <WalletBalance className="rounded-full border border-white/15 bg-white/[0.07] px-3 py-2 font-mono text-[9px] text-white/60" />
          </div>
          <WalletConnectButton />
        </div>
      </div>
    </header>
  )
}
