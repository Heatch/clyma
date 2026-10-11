"use client"

import { useMarkets } from "@/components/providers/MarketProvider"
import { usePositions } from "@/components/providers/PositionProvider"
import WalletConnectButton from "@/components/wallet/WalletConnectButton"

export default function AccountDock() {
  const { showPortfolio } = useMarkets()
  const { positions } = usePositions()
  const openPositions = positions.filter(
    (position) => position.status === "open",
  ).length

  return (
    <div
      className="absolute bottom-[max(1rem,env(safe-area-inset-bottom))] left-4 z-30 flex flex-col items-start gap-2 sm:left-6"
      data-testid="account-dock"
    >
      <div className="flex items-center gap-2">
        <WalletConnectButton />
        <button
          type="button"
          onClick={showPortfolio}
          aria-label={
            openPositions === 1
              ? "Open positions, 1 open position"
              : `Open positions, ${openPositions} open positions`
          }
          className="rounded-lg border border-white/15 bg-white/[0.06] px-3 py-2 text-xs font-semibold text-white transition hover:border-white/35 hover:bg-white/10"
        >
          Positions{" "}
          <span className="tabular ml-1 text-white/70">{openPositions}</span>
        </button>
      </div>
    </div>
  )
}
