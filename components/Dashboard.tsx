"use client"

import GlobeHero from "@/components/globe/GlobeHero"
import Navbar from "@/components/layout/Navbar"
import RegionalMarketDrawer from "@/components/markets/RegionalMarketDrawer"
import { GlobeLinkProvider } from "@/components/providers/GlobeLinkProvider"
import {
  MarketProvider,
  useMarkets,
} from "@/components/providers/MarketProvider"
import { PositionProvider } from "@/components/providers/PositionProvider"
import SolanaProvider from "@/components/providers/SolanaProvider"
import type { ClimateMarket } from "@/lib/markets/types"

function DashboardContent({ isDemo }: { isDemo: boolean }) {
  const { search, setSearch } = useMarkets()

  return (
    <div
      id="top"
      className="fixed inset-0 isolate h-[100svh] min-h-0 w-full overflow-hidden bg-[#030605] text-white"
    >
      <Navbar search={search} onSearchChange={setSearch} isDemo={isDemo} />
      <main
        id="globe-workspace"
        className="h-full min-h-0 min-w-0 overflow-hidden md:pl-52"
      >
        <GlobeHero />
      </main>
      <RegionalMarketDrawer />
    </div>
  )
}

export default function Dashboard({
  initialMarkets,
  isDemo = false,
}: {
  initialMarkets?: ClimateMarket[]
  isDemo?: boolean
}) {
  return (
    <SolanaProvider>
      <MarketProvider initialMarkets={initialMarkets} isDemo={isDemo}>
        <PositionProvider>
          <GlobeLinkProvider>
            <DashboardContent isDemo={isDemo} />
          </GlobeLinkProvider>
        </PositionProvider>
      </MarketProvider>
    </SolanaProvider>
  )
}
