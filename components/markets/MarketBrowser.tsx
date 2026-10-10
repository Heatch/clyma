"use client"

import MarketListItem from "@/components/markets/MarketListItem"
import {
  type MarketSort,
  useMarkets,
} from "@/components/providers/MarketProvider"
import { CATEGORY_LABELS } from "@/lib/markets/categories"
import { MARKET_CATEGORIES, MARKET_CONTINENTS } from "@/lib/markets/types"

const SORT_OPTIONS: Array<{ value: MarketSort; label: string }> = [
  { value: "closing", label: "Ending soon" },
  { value: "volume", label: "Most traded" },
  { value: "yes", label: "Highest YES" },
  { value: "trending", label: "Trending" },
]

export default function MarketBrowser() {
  const {
    browseFilters,
    browseScopeIds,
    browseResults,
    updateBrowseFilters,
    toggleBrowseCategory,
    toggleBrowseRegion,
    clearBrowseScope,
    resetBrowseFilters,
    selectMarket,
  } = useMarkets()
  const hasNarrowing =
    browseFilters.query.trim() !== "" ||
    browseFilters.categories.length > 0 ||
    browseFilters.regions.length > 0 ||
    browseScopeIds !== null

  return (
    <div>
      <h2 className="text-2xl font-semibold tracking-[-0.03em]">
        Search markets
      </h2>
      <p className="mt-1 text-xs leading-5 text-neutral-400">
        Search region, market type, title, or description.
      </p>

      <label className="mt-5 block" htmlFor="market-browser-search">
        <span className="sr-only">Search markets</span>
        <input
          id="market-browser-search"
          type="search"
          value={browseFilters.query}
          onChange={(event) =>
            updateBrowseFilters({ query: event.target.value })
          }
          placeholder="Search region, market type, title, description"
          className="h-11 w-full rounded-lg border border-white/15 bg-white/[0.06] px-4 text-sm text-white outline-none transition placeholder:text-neutral-500 hover:border-white/30 focus:border-white/60"
        />
      </label>

      <div className="mt-5 grid gap-6 sm:grid-cols-2">
        <fieldset>
          <legend className="text-xs font-semibold text-white/70">
            Market type
          </legend>
          <div className="mt-3 space-y-2.5">
            {MARKET_CATEGORIES.map((category) => (
              <label
                key={category}
                className="flex cursor-pointer items-center gap-2.5 text-sm text-neutral-200"
              >
                <input
                  type="checkbox"
                  checked={browseFilters.categories.includes(category)}
                  onChange={() => toggleBrowseCategory(category)}
                  className="size-4 accent-white"
                />
                {CATEGORY_LABELS[category]}
              </label>
            ))}
          </div>
          <p className="mt-3 text-[11px] text-neutral-500">
            Any selected = all types
          </p>
        </fieldset>

        <fieldset>
          <legend className="text-xs font-semibold text-white/70">
            Region
          </legend>
          <div className="mt-3 space-y-2.5">
            {MARKET_CONTINENTS.map((region) => (
              <label
                key={region}
                className="flex cursor-pointer items-center gap-2.5 text-sm text-neutral-200"
              >
                <input
                  type="checkbox"
                  checked={browseFilters.regions.includes(region)}
                  onChange={() => toggleBrowseRegion(region)}
                  className="size-4 accent-white"
                />
                {region}
              </label>
            ))}
          </div>
          <p className="mt-3 text-[11px] text-neutral-500">
            Any selected = all regions
          </p>
        </fieldset>
      </div>

      <div className="mt-5 flex items-center gap-3">
        <label
          htmlFor="market-browser-sort"
          className="text-xs font-semibold text-white/70"
        >
          Sort
        </label>
        <select
          id="market-browser-sort"
          value={browseFilters.sort}
          onChange={(event) =>
            updateBrowseFilters({ sort: event.target.value as MarketSort })
          }
          className="h-10 rounded-lg border border-white/15 bg-white/[0.06] px-3 text-sm text-white outline-none transition hover:border-white/30 focus:border-white/60"
        >
          {SORT_OPTIONS.map((option) => (
            <option
              key={option.value}
              value={option.value}
              className="text-black"
            >
              {option.label}
            </option>
          ))}
        </select>
      </div>

      {browseScopeIds && (
        <div className="mt-5 flex items-center justify-between gap-3 rounded-lg border border-white/15 bg-white/[0.04] px-3 py-2">
          <p className="text-xs text-white/70">
            {browseResults.length}{" "}
            {browseResults.length === 1 ? "market" : "markets"} at this spot
          </p>
          <button
            type="button"
            onClick={clearBrowseScope}
            aria-label="Remove spot filter"
            className="grid size-8 place-items-center text-lg text-neutral-300 transition hover:text-white"
          >
            ×
          </button>
        </div>
      )}

      <div className="mt-5 flex items-baseline justify-between gap-3">
        <h3
          className="text-xl font-semibold tracking-[-0.025em]"
          aria-live="polite"
        >
          {browseResults.length}{" "}
          {browseResults.length === 1 ? "market" : "markets"}
        </h3>
        {hasNarrowing && (
          <button
            type="button"
            onClick={resetBrowseFilters}
            className="text-xs font-semibold text-neutral-300 underline decoration-neutral-600 underline-offset-4 transition hover:text-white"
          >
            Clear search and filters
          </button>
        )}
      </div>

      {browseResults.length > 0 ? (
        <div className="mt-4 space-y-3" data-testid="browse-market-list">
          {browseResults.map((market) => (
            <MarketListItem
              key={market.id}
              market={market}
              onSelect={selectMarket}
              tone="dark"
            />
          ))}
        </div>
      ) : (
        <div className="mt-4 rounded-lg border border-dashed border-white/20 bg-white/[0.03] px-5 py-12 text-center">
          <p className="text-sm font-semibold">No matching markets</p>
          <p className="mt-1 text-xs text-neutral-400">
            Try a different search term or broaden the selected filters.
          </p>
        </div>
      )}
    </div>
  )
}
