"use client"

import { MiniMarketChart } from "@/components/markets/MarketChart"
import HazardIcon from "@/components/icons/HazardIcon"
import { useGlobeLink } from "@/components/providers/GlobeLinkProvider"
import { useMarkets } from "@/components/providers/MarketProvider"
import { CATEGORY_LABELS } from "@/lib/markets/categories"
import type { ClimateMarket } from "@/lib/markets/types"
import {
  formatCompact,
  formatCountdown,
  formatProbability,
} from "@/lib/utils/format"
import { clampProbability, likelihoodColor } from "@/lib/utils/likelihood"

const CLOSING_SOON_DAYS = 30
const NEW_DAYS = 35
const DAY_MS = 86_400_000

interface MarketListItemProps {
  market: ClimateMarket
  onSelect: (market: ClimateMarket) => void
  compact?: boolean
  tone?: "light" | "dark"
}

export default function MarketListItem({
  market,
  onSelect,
  compact = false,
  tone = "light",
}: MarketListItemProps) {
  const { setHoveredMarketId } = useGlobeLink()
  const { now } = useMarkets()
  const yesProbability = formatProbability(market.yesPrice)
  const noProbability = formatProbability(market.noPrice)
  const yesPercent = Math.round(clampProbability(market.yesPrice) * 100)

  // `now` stays 0 until resolved in an effect, so tags simply hide until then
  // (keeps render pure and avoids hydration mismatches from Date.now()).
  const daysToClose = (Date.parse(market.closeTime) - now) / DAY_MS
  const isClosingSoon =
    now > 0 &&
    market.status === "open" &&
    daysToClose > 0 &&
    daysToClose <= CLOSING_SOON_DAYS
  const daysSinceCreated = (now - Date.parse(market.createdAt)) / DAY_MS
  const isNew = now > 0 && daysSinceCreated >= 0 && daysSinceCreated <= NEW_DAYS
  const isDark = tone === "dark"

  return (
    <button
      type="button"
      onClick={() => onSelect(market)}
      onMouseEnter={() => setHoveredMarketId(market.id)}
      onMouseLeave={() => setHoveredMarketId(null)}
      onFocus={() => setHoveredMarketId(market.id)}
      onBlur={() => setHoveredMarketId(null)}
      className={`group w-full rounded-2xl border text-left transition hover:-translate-y-0.5 hover:shadow-lg ${
        isDark
          ? "border-white/10 bg-white/[0.055] text-white hover:border-white/25 hover:bg-white/[0.09] hover:shadow-black/30"
          : "border-neutral-200 bg-white hover:border-neutral-400 hover:shadow-black/5"
      } ${compact ? "p-3.5" : "p-4"}`}
      aria-label={`Open market: ${market.question}. Hazard type ${CATEGORY_LABELS[market.category]}. YES ${yesProbability}, NO ${noProbability}.`}
    >
      <div className="flex items-start gap-3">
        <span
          className={`grid size-9 shrink-0 place-items-center rounded-full border ${
            isDark
              ? "border-white/15 bg-white/[0.05] text-white/70"
              : "border-neutral-200 bg-neutral-50 text-neutral-600"
          }`}
          aria-hidden="true"
        >
          <HazardIcon category={market.category} className="size-[18px]" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 overflow-hidden">
            <span
              className={`eyebrow truncate ${isDark ? "!text-neutral-400" : ""}`}
            >
              {market.region} · {CATEGORY_LABELS[market.category]}
            </span>
            <span
              className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide ${
                isDark
                  ? "bg-white/10 text-neutral-300"
                  : "bg-neutral-100 text-neutral-500"
              }`}
            >
              {market.status}
            </span>
            {isClosingSoon && (
              <span className="shrink-0 rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-700">
                Closing soon
              </span>
            )}
            {isNew && (
              <span
                className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${
                  isDark
                    ? "bg-white text-neutral-950"
                    : "bg-neutral-900 text-white"
                }`}
              >
                New
              </span>
            )}
          </div>
          <h3
            className={`mt-2 font-semibold leading-snug tracking-[-0.015em] ${compact ? "text-[13px]" : "text-sm"}`}
          >
            {market.question}
          </h3>
        </div>
        <span
          className={`mt-1 transition group-hover:translate-x-0.5 ${
            isDark
              ? "text-neutral-500 group-hover:text-white"
              : "text-neutral-400 group-hover:text-ink"
          }`}
          aria-hidden="true"
        >
          →
        </span>
      </div>

      <div
        className={`mt-4 grid grid-cols-[1fr_auto] items-end gap-3 border-t pt-3 ${
          isDark ? "border-white/10" : "border-neutral-100"
        }`}
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <span
              className={`rounded-md px-2 py-1 text-[10px] font-bold ${
                isDark ? "bg-white text-neutral-950" : "bg-ink text-white"
              }`}
            >
              YES {yesProbability}
            </span>
            <span
              className={`rounded-md border px-2 py-1 text-[10px] font-bold ${
                isDark
                  ? "border-white/20 text-neutral-300"
                  : "border-neutral-300 text-neutral-600"
              }`}
            >
              NO {noProbability}
            </span>
          </div>
          <div
            className={`mt-2 h-1.5 w-full overflow-hidden rounded-full ${
              isDark ? "bg-white/10" : "bg-neutral-200"
            }`}
            role="img"
            aria-label={`YES likelihood ${yesProbability}`}
          >
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${yesPercent}%`,
                backgroundColor: likelihoodColor(market.yesPrice),
              }}
            />
          </div>
          <p
            className={`mt-2 text-[10px] ${
              isDark ? "text-neutral-400" : "text-neutral-500"
            }`}
          >
            {formatCompact(market.totalVolume)} SOL volume ·{" "}
            {formatCountdown(market.closeTime)}
          </p>
        </div>
        <div className={isDark ? "text-neutral-200" : "text-ink"}>
          <MiniMarketChart history={market.history} />
        </div>
      </div>
    </button>
  )
}
