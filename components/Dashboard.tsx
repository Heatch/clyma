"use client"

import GlobeHero from "@/components/globe/GlobeHero"
import Navbar from "@/components/layout/Navbar"
import MarketBoard from "@/components/markets/MarketBoard"
import MarketControls from "@/components/markets/MarketControls"
import RegionalMarketDrawer from "@/components/markets/RegionalMarketDrawer"
import TrendingMarkets from "@/components/markets/TrendingMarkets"
import PortfolioPanel from "@/components/portfolio/PortfolioPanel"
import { GlobeLinkProvider } from "@/components/providers/GlobeLinkProvider"
import {
  MarketProvider,
  useMarkets,
} from "@/components/providers/MarketProvider"
import { PositionProvider } from "@/components/providers/PositionProvider"
import SolanaProvider from "@/components/providers/SolanaProvider"
import { CONTINENTS } from "@/lib/geo/regions"
import type { ClimateMarket } from "@/lib/markets/types"
import { formatCompact, formatProbability, formatSol } from "@/lib/utils/format"

function DashboardContent() {
  const { markets, search, setSearch, selectRegion, selectMarket } =
    useMarkets()

  const openMarkets = markets.filter((market) => market.status === "open")
  const totalPool = openMarkets.reduce(
    (sum, market) => sum + market.yesLiquidity + market.noLiquidity,
    0,
  )
  const totalVolume = openMarkets.reduce(
    (sum, market) => sum + market.totalVolume,
    0,
  )
  const featured = [...openMarkets].sort(
    (a, b) => b.trendingScore - a.trendingScore,
  )[0]

  return (
    <div id="top" className="min-h-screen">
      <Navbar search={search} onSearchChange={setSearch} />

      <GlobeHero />

      <main className="mx-auto max-w-[1600px] px-4 pb-16 pt-10 sm:px-6 sm:pt-14 lg:px-8">
        <section
          className="grid items-end gap-6 lg:grid-cols-[minmax(0,1fr)_auto]"
          aria-labelledby="dashboard-title"
        >
          <div>
            <div className="flex items-center gap-2">
              <span
                className="soft-pulse size-1.5 rounded-full bg-ink"
                aria-hidden="true"
              />
              <p className="eyebrow">Geographic prediction markets · Devnet</p>
            </div>
            <h1
              id="dashboard-title"
              className="mt-3 max-w-4xl text-4xl font-semibold leading-[0.98] tracking-[-0.055em] sm:text-5xl lg:text-6xl"
            >
              Forecast climate risk.
              <br className="hidden sm:block" /> Hedge what happens next.
            </h1>
          </div>
          <p className="max-w-md text-sm leading-6 text-neutral-600 lg:max-w-xs lg:text-right">
            Explore pooled binary markets mapped to real places. All events,
            charts, balances, and activity shown here are experimental sample
            data.
          </p>
        </section>

        <section className="mt-8 grid content-start gap-4 sm:grid-cols-2">
          <section className="panel p-5" aria-labelledby="pulse-heading">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="eyebrow">Demo network</p>
                <h2 id="pulse-heading" className="mt-1 text-lg font-semibold">
                  Market pulse
                </h2>
              </div>
              <span className="rounded-full bg-ink px-2.5 py-1 text-[9px] font-bold uppercase tracking-wider text-white">
                Devnet
              </span>
            </div>
            <dl className="mt-5 grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-neutral-100 p-3">
                <dt className="text-[9px] font-bold uppercase tracking-wider text-neutral-500">
                  Active
                </dt>
                <dd className="tabular mt-1 text-2xl font-semibold">
                  {openMarkets.length}
                </dd>
              </div>
              <div className="rounded-xl bg-neutral-100 p-3">
                <dt className="text-[9px] font-bold uppercase tracking-wider text-neutral-500">
                  Regions
                </dt>
                <dd className="tabular mt-1 text-2xl font-semibold">
                  {CONTINENTS.length}
                </dd>
              </div>
              <div className="rounded-xl bg-neutral-100 p-3">
                <dt className="text-[9px] font-bold uppercase tracking-wider text-neutral-500">
                  Sample pool
                </dt>
                <dd className="tabular mt-1 text-sm font-semibold">
                  {formatSol(totalPool)}
                </dd>
              </div>
              <div className="rounded-xl bg-neutral-100 p-3">
                <dt className="text-[9px] font-bold uppercase tracking-wider text-neutral-500">
                  Volume
                </dt>
                <dd className="tabular mt-1 text-sm font-semibold">
                  {formatCompact(totalVolume)} SOL
                </dd>
              </div>
            </dl>
            {featured && (
              <button
                type="button"
                onClick={() => selectMarket(featured)}
                className="mt-4 w-full rounded-xl border border-neutral-200 bg-white p-3 text-left transition hover:border-ink"
              >
                <p className="text-[9px] font-bold uppercase tracking-wider text-neutral-500">
                  Highest demo activity
                </p>
                <p className="mt-1.5 line-clamp-2 text-xs font-semibold leading-4">
                  {featured.question}
                </p>
                <p className="mt-2 text-[10px] font-bold">
                  YES {formatProbability(featured.yesPrice)}{" "}
                  <span className="float-right font-medium text-neutral-500">
                    Inspect →
                  </span>
                </p>
              </button>
            )}
          </section>

          <section className="panel p-5" aria-labelledby="regions-heading">
            <p className="eyebrow">Accessible atlas</p>
            <h2 id="regions-heading" className="mt-1 text-lg font-semibold">
              Explore by region
            </h2>
            <div className="mt-4 divide-y divide-neutral-100 rounded-xl border border-neutral-200 bg-white px-3">
              {CONTINENTS.map((continent) => {
                const regionMarkets = openMarkets.filter(
                  (market) => market.continent === continent,
                )
                const average =
                  regionMarkets.length > 0
                    ? regionMarkets.reduce(
                        (sum, market) => sum + market.yesPrice,
                        0,
                      ) / regionMarkets.length
                    : 0
                return (
                  <button
                    type="button"
                    key={continent}
                    onClick={() => selectRegion(continent)}
                    className="flex w-full items-center gap-3 py-3 text-left text-xs transition hover:pl-1"
                  >
                    <span className="min-w-0 flex-1 font-semibold">
                      {continent}
                    </span>
                    <span className="text-[10px] text-neutral-500">
                      {regionMarkets.length} active
                    </span>
                    {regionMarkets.length > 0 && (
                      <span className="tabular w-9 text-right text-[10px] font-bold">
                        {formatProbability(average)}
                      </span>
                    )}
                    <span aria-hidden="true">→</span>
                  </button>
                )
              })}
            </div>
          </section>
        </section>

        <div className="mt-12 sm:mt-16">
          <TrendingMarkets />
        </div>

        <section className="mt-12 sm:mt-16" aria-labelledby="board-heading">
          <div>
            <p className="eyebrow">Full market board</p>
            <h2
              id="board-heading"
              className="mt-1 text-2xl font-semibold tracking-[-0.03em]"
            >
              All climate markets
            </h2>
          </div>
          <div className="mt-4">
            <MarketControls />
          </div>
          <div className="mt-5">
            <MarketBoard />
          </div>
        </section>

        <section className="mt-12 grid gap-5 sm:mt-16 lg:grid-cols-[minmax(0,1.2fr)_minmax(340px,0.8fr)]">
          <div className="rounded-[1.5rem] bg-ink p-6 text-white sm:p-8">
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-neutral-400">
              How settlement works
            </p>
            <h2 className="mt-2 max-w-xl text-2xl font-semibold tracking-[-0.035em] sm:text-3xl">
              A transparent pooled binary model.
            </h2>
            <p className="mt-4 max-w-2xl text-sm leading-6 text-neutral-400">
              YES and NO deposits share one program-controlled vault. After the
              authorized resolver records an outcome, winning deposits receive a
              proportional share of the full pool. Cancelled markets return
              original deposits.
            </p>
            <div className="mt-6 rounded-xl border border-white/15 bg-white/5 p-4 font-mono text-xs leading-6 text-neutral-200">
              payout = winning position × total pool ÷ winning-side pool
            </div>
            <div className="mt-6 grid gap-4 sm:grid-cols-3">
              {[
                ["01", "Commit", "Choose YES or NO and deposit Devnet SOL."],
                [
                  "02",
                  "Resolve",
                  "An authorized signer applies published rules after close.",
                ],
                [
                  "03",
                  "Claim",
                  "Winners claim once; cancelled positions receive refunds.",
                ],
              ].map(([number, title, copy]) => (
                <div key={number} className="border-t border-white/15 pt-3">
                  <p className="text-[10px] font-bold text-neutral-500">
                    {number}
                  </p>
                  <p className="mt-2 text-sm font-semibold">{title}</p>
                  <p className="mt-1 text-[11px] leading-4 text-neutral-400">
                    {copy}
                  </p>
                </div>
              ))}
            </div>
          </div>
          <PortfolioPanel />
        </section>
      </main>

      <footer className="border-t border-neutral-300 bg-white/70 px-4 py-8 sm:px-6 lg:px-8">
        <div className="mx-auto flex max-w-[1536px] flex-col gap-4 text-[10px] leading-4 text-neutral-500 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs font-bold text-ink">Klashi Climate Markets</p>
            <p className="mt-1">
              Experimental Solana Devnet prototype · Not a production financial
              service
            </p>
          </div>
          <p className="max-w-2xl sm:text-right">
            Never share a seed phrase. Demo markets and climate histories are
            fictional. Real-world outcomes require an authorized resolver; the
            program does not independently observe climate events.
          </p>
        </div>
      </footer>

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
