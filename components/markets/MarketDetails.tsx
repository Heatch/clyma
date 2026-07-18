"use client"

import { useEffect, useMemo, useState } from "react"

import HazardIcon from "@/components/icons/HazardIcon"
import MarketChart from "@/components/markets/MarketChart"
import PredictionForm from "@/components/trading/PredictionForm"
import RedeemPosition from "@/components/trading/RedeemPosition"
import { CATEGORY_LABELS } from "@/lib/markets/categories"
import type { ClimateMarket } from "@/lib/markets/types"
import {
  formatCompact,
  formatCountdown,
  formatDateTime,
  formatProbability,
  formatSol,
  shortenAddress,
} from "@/lib/utils/format"

interface MarketDetailsProps {
  market: ClimateMarket
  onBack: () => void
}

export default function MarketDetails({ market, onBack }: MarketDetailsProps) {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(timer)
  }, [])

  const currentProbability = market.yesPrice
  const probabilityChange = useMemo(() => {
    const first = market.history[0]?.yesProbability ?? currentProbability
    return (currentProbability - first) * 100
  }, [currentProbability, market.history])
  const totalLiquidity = market.yesLiquidity + market.noLiquidity
  const displayQuestion = market.question.replace(/^\[DEMO\]\s*/i, "")
  return (
    <article aria-labelledby="market-question" className="pb-8 text-white">
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={onBack}
          className="rounded-full border border-white/15 bg-white/[0.04] px-3 py-1.5 font-mono text-[9px] uppercase tracking-[0.1em] text-white/55 transition hover:border-white/35 hover:bg-white/10 hover:text-white"
        >
          ← {market.continent}
        </button>
        <div className="flex items-center gap-2 font-mono text-[8px] uppercase tracking-[0.13em]">
          <span className="rounded-full border border-white/10 px-2.5 py-1 text-white/35">
            {market.dataLabel}
          </span>
          <span className="flex items-center gap-1.5 rounded-full border border-emerald-300/20 bg-emerald-300/10 px-2.5 py-1 text-emerald-200">
            <span className="size-1 rounded-full bg-emerald-300" />
            {market.status}
          </span>
        </div>
      </div>

      <div className="mt-5 flex items-start gap-3">
        <span
          className="grid size-10 shrink-0 place-items-center rounded-xl border border-white/15 bg-white/[0.035] text-white/70"
          aria-hidden="true"
        >
          <HazardIcon category={market.category} className="size-5" />
        </span>
        <div className="min-w-0">
          <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-white/35">
            {market.region} · {CATEGORY_LABELS[market.category]}
          </p>
          <p className="mt-1 text-[10px] text-white/30">
            {market.country ?? market.continent} · Closes{" "}
            {formatCountdown(market.closeTime, now)}
          </p>
        </div>
      </div>

      <h2
        id="market-question"
        className="mt-4 text-[1.55rem] font-medium leading-[1.12] tracking-[-0.04em] text-white sm:text-[1.75rem]"
      >
        {displayQuestion}
      </h2>
      <p className="mt-3 text-[11px] leading-5 text-white/55">
        {market.description}
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2 font-mono text-[8px] uppercase tracking-[0.12em]">
        <span
          className={`rounded-full border px-2.5 py-1 ${
            market.chainState === "synced"
              ? "border-emerald-300/25 bg-emerald-300/10 text-emerald-100"
              : market.chainState === "missing" || market.chainState === "error"
                ? "border-amber-300/25 bg-amber-300/10 text-amber-100"
                : "border-white/10 bg-white/[0.04] text-white/45"
          }`}
        >
          {market.chainState === "synced"
            ? "Devnet account verified"
            : market.chainState === "loading"
              ? "Checking Devnet account"
              : market.chainState === "missing"
                ? "Demo market not on-chain"
                : market.chainState === "error"
                  ? "Devnet state unavailable"
                  : "Demo metadata only"}
        </span>
      </div>

      <div className="mt-5 grid grid-cols-[minmax(0,1fr)_auto] items-end gap-4 border-y border-white/10 py-4">
        <div>
          <p className="font-mono text-[8px] uppercase tracking-[0.15em] text-white/35">
            Market probability
          </p>
          <div className="mt-1 flex items-end gap-2">
            <span className="tabular text-5xl font-medium leading-none tracking-[-0.06em] text-white">
              {formatProbability(currentProbability)}
            </span>
            <span
              className={`mb-1 rounded-full px-2 py-1 font-mono text-[9px] ${
                probabilityChange >= 0
                  ? "bg-emerald-300/10 text-emerald-200"
                  : "bg-rose-300/10 text-rose-200"
              }`}
            >
              {probabilityChange >= 0 ? "+" : ""}
              {probabilityChange.toFixed(1)} pts
            </span>
          </div>
        </div>
        <div className="text-right font-mono text-[9px] uppercase tracking-[0.1em] text-white/30">
          <p>{formatCompact(market.participants)} traders</p>
          <p className="mt-1">{formatCompact(market.totalVolume)} SOL vol.</p>
        </div>
      </div>

      <section
        className="mt-5 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.035] p-3.5 sm:p-4"
        aria-labelledby="history-heading"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-mono text-[8px] uppercase tracking-[0.15em] text-white/30">
              Prediction analysis
            </p>
            <h3
              id="history-heading"
              className="mt-1 text-xs font-medium text-white/80"
            >
              Implied probability over time
            </h3>
          </div>
          <span className="rounded-full border border-white/10 px-2 py-1 font-mono text-[8px] uppercase tracking-[0.1em] text-white/30">
            Simulated
          </span>
        </div>
        <div className="mt-2">
          <MarketChart history={market.history} tone="dark" />
        </div>
      </section>

      <PredictionForm market={market} tone="dark" />
      {market.status !== "open" && <RedeemPosition market={market} />}

      <dl className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-white/10 bg-white/10 font-mono sm:grid-cols-4">
        {[
          ["YES pool", formatSol(market.yesLiquidity)],
          ["NO pool", formatSol(market.noLiquidity)],
          ["Liquidity", formatSol(totalLiquidity)],
          ["Closes", formatCountdown(market.closeTime, now)],
        ].map(([label, value]) => (
          <div key={label} className="bg-[#0a0e0d] p-3">
            <dt className="text-[8px] uppercase tracking-[0.12em] text-white/30">
              {label}
            </dt>
            <dd className="tabular mt-1.5 text-[10px] text-white/75">
              {value}
            </dd>
          </div>
        ))}
      </dl>

      <div className="mt-5 space-y-2">
        <details className="group rounded-xl border border-white/10 bg-white/[0.025] open:bg-white/[0.045]">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between px-3.5 font-mono text-[9px] uppercase tracking-[0.12em] text-white/50 marker:hidden">
            Resolution protocol
            <span className="text-white/25 transition group-open:rotate-45">
              +
            </span>
          </summary>
          <div className="border-t border-white/10 px-3.5 py-4 text-[11px] leading-5 text-white/45">
            <p>{market.resolutionRules}</p>
            <p className="mt-3">
              <span className="text-white/70">Resolver:</span>{" "}
              {shortenAddress(market.resolver, 6)}
            </p>
            <p className="mt-1">
              <span className="text-white/70">Scheduled close:</span>{" "}
              {formatDateTime(market.closeTime)}
            </p>
            <a
              href={market.resolutionSourceUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-3 inline-block text-white/75 underline decoration-white/25 underline-offset-4 hover:text-white"
            >
              {market.resolutionSource} ↗
            </a>
          </div>
        </details>

        <details className="group rounded-xl border border-white/10 bg-white/[0.025] open:bg-white/[0.045]">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between px-3.5 font-mono text-[9px] uppercase tracking-[0.12em] text-white/50 marker:hidden">
            Evidence & methodology
            <span className="text-white/25 transition group-open:rotate-45">
              +
            </span>
          </summary>
          <div className="space-y-2 border-t border-white/10 p-3">
            {market.evidence.map((item) => (
              <a
                key={item.id}
                href={item.url}
                target="_blank"
                rel="noreferrer"
                className="block rounded-lg border border-white/10 bg-black/20 p-3 transition hover:border-white/25"
              >
                <p className="text-[11px] font-medium text-white/75">
                  {item.title}
                </p>
                <p className="mt-1 text-[10px] leading-4 text-white/35">
                  {item.summary}
                </p>
              </a>
            ))}
          </div>
        </details>

        <details className="group rounded-xl border border-white/10 bg-white/[0.025] open:bg-white/[0.045]">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between px-3.5 font-mono text-[9px] uppercase tracking-[0.12em] text-white/50 marker:hidden">
            Recent simulated trades ({market.recentTrades.length})
            <span className="text-white/25 transition group-open:rotate-45">
              +
            </span>
          </summary>
          <div className="divide-y divide-white/10 border-t border-white/10 px-3.5">
            {market.recentTrades.slice(0, 5).map((trade) => (
              <div
                key={trade.id}
                className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 py-3 font-mono text-[9px]"
              >
                <span
                  className={`rounded px-2 py-1 ${
                    trade.side === "yes"
                      ? "bg-emerald-300/10 text-emerald-200"
                      : "bg-rose-300/10 text-rose-200"
                  }`}
                >
                  {trade.side.toUpperCase()}
                </span>
                <span className="truncate text-white/30">
                  {shortenAddress(trade.wallet)}
                </span>
                <span className="tabular text-white/65">
                  {formatSol(trade.amountSol, 3)} @{" "}
                  {formatProbability(trade.probability)}
                </span>
              </div>
            ))}
          </div>
        </details>
      </div>

      <p className="mt-5 border-t border-white/10 pt-4 text-[9px] leading-4 text-white/25">
        Fictional Devnet demonstration data. Probabilities reflect each side’s
        simulated share of a pooled binary market and are not climate forecasts.
      </p>
    </article>
  )
}
