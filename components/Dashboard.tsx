"use client"

import { useCallback, useState } from "react"

import GlobeHero from "@/components/globe/GlobeHero"
import Navbar from "@/components/layout/Navbar"
import MarketDeskDrawer from "@/components/markets/MarketDeskDrawer"
import RegionalMarketDrawer from "@/components/markets/RegionalMarketDrawer"
import { GlobeLinkProvider } from "@/components/providers/GlobeLinkProvider"
import {
  MarketProvider,
  useMarkets,
} from "@/components/providers/MarketProvider"
import { PositionProvider } from "@/components/providers/PositionProvider"
import SolanaProvider from "@/components/providers/SolanaProvider"

function DashboardContent() {
  const { search, setSearch, closeDrawer } = useMarkets()
  const [isMarketDeskOpen, setIsMarketDeskOpen] = useState(false)
  const openMarketDesk = useCallback(() => {
    closeDrawer()
    setIsMarketDeskOpen(true)
  }, [closeDrawer])
  const closeMarketDesk = useCallback(() => setIsMarketDeskOpen(false), [])

  return (
    <div
      id="top"
      className="fixed inset-0 isolate h-[100svh] min-h-0 w-full overflow-hidden bg-[#030605] text-white"
    >
      <Navbar
        search={search}
        onSearchChange={setSearch}
        isMarketDeskOpen={isMarketDeskOpen}
        onMarketDeskOpen={openMarketDesk}
      />
      <main
        id="globe-workspace"
        className="h-full min-h-0 min-w-0 overflow-hidden md:pl-64"
      >
        <GlobeHero />
      </main>
      <RegionalMarketDrawer />
      <MarketDeskDrawer isOpen={isMarketDeskOpen} onClose={closeMarketDesk} />
    </div>
  )
}

export default function Dashboard() {
  return (
    <SolanaProvider>
      <MarketProvider>
        <PositionProvider>
          <GlobeLinkProvider>
            <DashboardContent />
          </GlobeLinkProvider>
        </PositionProvider>
      </MarketProvider>
    </SolanaProvider>
  )
}
