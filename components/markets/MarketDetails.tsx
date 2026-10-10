"use client"

import { useEffect, useState } from "react"

import MarketChart from "@/components/markets/MarketChart"
import PredictionForm, {
  type TradePreview,
} from "@/components/trading/PredictionForm"
import RedeemPosition from "@/components/trading/RedeemPosition"
import { useAIForecast } from "@/hooks/useAIForecast"
import { CATEGORY_LABELS } from "@/lib/markets/categories"
import type { ClimateMarket, TradeConfirmedDetail } from "@/lib/markets/types"
import { TRADE_CONFIRMED_EVENT } from "@/lib/markets/types"
import {
  formatCompact,
  formatCountdown,
  formatProbability,
  formatSol,
  shortenAddress,
} from "@/lib/utils/format"

interface MarketDetailsProps {
  market: ClimateMarket
}

export default function MarketDetails({ market }: MarketDetailsProps) {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(timer)
  }, [])

  const { probability: modelProb } = useAIForecast(
    market.question,
    market.resolutionRules,
  )
  const [preview, setPreview] = useState<TradePreview | null>(null)
  const [lastTrade, setLastTrade] = useState<{
    at: number
    deltaPts: number
  } | null>(null)

  const history = market.history
  const totalLiquidity = market.yesLiquidity + market.noLiquidity

  useEffect(() => {
    setPreview(null)
    setLastTrade(null)
  }, [market.id])

  useEffect(() => {
    let timer: number | undefined
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<TradeConfirmedDetail>).detail
      if (!detail || detail.marketId !== market.id) return
      setLastTrade({
        at: Date.now(),
        deltaPts: (detail.yesProbabilityAfter - market.yesPrice) * 100,
      })
      window.clearTimeout(timer)
      timer = window.setTimeout(() => setLastTrade(null), 15000)
    }
    window.addEventListener(TRADE_CONFIRMED_EVENT, handler)
    return () => {
      window.removeEventListener(TRADE_CONFIRMED_EVENT, handler)
      window.clearTimeout(timer)
    }
  }, [market.id, market.yesPrice])

  return (
    <article aria-labelledby="market-question" className="pb-8 text-white">
      <p className="text-xs text-white/50">
        {market.region} · {CATEGORY_LABELS[market.category]} · Closes{" "}
        {formatCountdown(market.closeTime, now)}
      </p>

      <h2
        id="market-question"
        className="mt-3 text-[1.55rem] font-medium leading-[1.12] tracking-[-0.04em] text-white sm:text-[1.75rem]"
      >
        {market.question}
      </h2>
      <p className="mt-3 text-[11px] leading-5 text-white/55">
        {market.description}
      </p>

      <section className="mt-5" aria-label="Probability history">
        <MarketChart
          history={history}
          tone="dark"
          forecastProb={modelProb}
          previewProb={preview?.yesProbability ?? null}
          recentTradeDeltaPts={lastTrade?.deltaPts ?? null}
        />
        <p className="mt-3 text-[11px] text-white/40">
          {formatCompact(market.participants)} traders ·{" "}
          {formatCompact(market.totalVolume)} SOL traded ·{" "}
          {formatSol(totalLiquidity)} pool
        </p>
      </section>

      <PredictionForm
        market={market}
        tone="dark"
        onPreviewChange={setPreview}
      />
      {market.status !== "open" && <RedeemPosition market={market} />}

      <div className="mt-5 space-y-2">
        <details className="group rounded-xl border border-white/10 bg-white/[0.025] open:bg-white/[0.045]">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between px-3.5 text-xs font-medium text-white/70 marker:hidden">
            Resolution & evidence
            <span className="text-white/25 transition group-open:rotate-45">
              +
            </span>
          </summary>
          <div className="border-t border-white/10 px-3.5 py-4 text-[12px] leading-6 text-white/55">
            <p>{market.resolutionRules}</p>
            <p className="mt-3">
              <span className="text-white/80">Resolver:</span>{" "}
              {shortenAddress(market.resolver, 6)}
            </p>
            <a
              href={market.resolutionSourceUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-3 inline-block text-white/80 underline decoration-white/25 underline-offset-4 hover:text-white"
            >
              {market.resolutionSource} ↗
            </a>
            <div className="mt-4 space-y-2">
              {market.evidence.map((item) => (
                <a
                  key={item.id}
                  href={item.url}
                  target="_blank"
                  rel="noreferrer"
                  className="block rounded-lg border border-white/10 bg-black/20 p-3 transition hover:border-white/25"
                >
                  <p className="text-[12px] font-medium text-white/80">
                    {item.title}
                  </p>
                  <p className="mt-1 text-[11px] leading-5 text-white/45">
                    {item.summary}
                  </p>
                </a>
              ))}
            </div>
          </div>
        </details>

        <details className="group rounded-xl border border-white/10 bg-white/[0.025] open:bg-white/[0.045]">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between px-3.5 text-xs font-medium text-white/70 marker:hidden">
            Recent trades ({market.recentTrades.length})
            <span className="text-white/25 transition group-open:rotate-45">
              +
            </span>
          </summary>
          <div className="divide-y divide-white/10 border-t border-white/10 px-3.5">
            {market.recentTrades.slice(0, 5).map((trade) => (
              <div
                key={trade.id}
                className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 py-3 text-[11px]"
              >
                <span
                  className={
                    trade.side === "yes" ? "text-emerald-200" : "text-rose-200"
                  }
                >
                  {trade.side.toUpperCase()}
                </span>
                <span className="truncate text-white/40">
                  {shortenAddress(trade.wallet)}
                </span>
                <span className="tabular text-white/70">
                  {formatSol(trade.amountSol, 3)} @{" "}
                  {formatProbability(trade.probability)}
                </span>
              </div>
            ))}
          </div>
        </details>
      </div>
    </article>
  )
}
