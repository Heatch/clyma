"use client"

import AccountDock from "@/components/layout/AccountDock"
import GlobeHero from "@/components/globe/GlobeHero"
import RegionalMarketDrawer from "@/components/markets/RegionalMarketDrawer"
import { GlobeLinkProvider } from "@/components/providers/GlobeLinkProvider"
import { MarketProvider } from "@/components/providers/MarketProvider"
import { PositionProvider } from "@/components/providers/PositionProvider"
import SolanaProvider from "@/components/providers/SolanaProvider"
import type { ClimateMarket } from "@/lib/markets/types"

function DashboardContent() {
  return (
    <div
      id="top"
      className="fixed inset-0 isolate h-[100svh] min-h-0 w-full overflow-hidden bg-[#030605] text-white"
    >
      <main
        id="globe-workspace"
        className="h-full min-h-0 min-w-0 overflow-hidden"
      >
        <GlobeHero />
      </main>
      <AccountDock />
      <RegionalMarketDrawer />
    </div>
  )
}

export default function Dashboard({
  initialMarkets,
}: {
  initialMarkets?: ClimateMarket[]
}) {
  return (
    <SolanaProvider>
      <MarketProvider initialMarkets={initialMarkets}>
        <PositionProvider>
          <GlobeLinkProvider>
            <DashboardContent />
          </GlobeLinkProvider>
        </PositionProvider>
      </MarketProvider>
    </SolanaProvider>
  )
}
