"use client"

import MarketListItem from "@/components/markets/MarketListItem"
import { useMarkets } from "@/components/providers/MarketProvider"
import { MarketCardSkeleton } from "@/components/ui/Skeleton"

export default function TrendingMarkets() {
  const { visibleMarkets, selectMarket, isLoading } = useMarkets()
  const trendingMarkets = [...visibleMarkets]
    .filter((market) => market.status === "open")
    .sort((first, second) => second.trendingScore - first.trendingScore)
    .slice(0, 4)

  return (
    <section aria-labelledby="trending-heading">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Market signal</p>
          <h2
            id="trending-heading"
            className="mt-1 text-2xl font-semibold tracking-[-0.03em]"
          >
            Trending climate risks
          </h2>
        </div>
        <p className="hidden max-w-sm text-right text-[10px] leading-4 text-neutral-500 sm:block">
          Ranked by market activity—not an investment recommendation.
        </p>
      </div>
      {isLoading ? (
        <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <MarketCardSkeleton key={`trending-skeleton-${index}`} />
          ))}
        </div>
      ) : trendingMarkets.length > 0 ? (
        <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {trendingMarkets.map((market) => (
            <MarketListItem
              compact
              key={market.id}
              market={market}
              onSelect={selectMarket}
            />
          ))}
        </div>
      ) : (
        <div className="mt-5 rounded-2xl border border-dashed border-neutral-300 px-5 py-12 text-center text-sm text-neutral-500">
          No open markets match the current search and risk filter.
        </div>
      )}
    </section>
  )
}
