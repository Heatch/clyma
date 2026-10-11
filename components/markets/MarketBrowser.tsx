"use client"

import MarketListItem from "@/components/markets/MarketListItem"
import MultiSelect from "@/components/markets/MultiSelect"
import {
  DEFAULT_SORT_DIRECTIONS,
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
  const isReversedOrder =
    browseFilters.sortDirection !== DEFAULT_SORT_DIRECTIONS[browseFilters.sort]
  const hasNarrowing =
    browseFilters.query.trim() !== "" ||
    browseFilters.categories.length > 0 ||
    browseFilters.regions.length > 0 ||
    browseScopeIds !== null

  return (
    <div>
      <label className="mt-1 block" htmlFor="market-browser-search">
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

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <div>
          <p className="text-xs font-semibold text-white/70">Market type</p>
          <div className="mt-2">
            <MultiSelect
              label="Market type filter"
              allLabel="All types"
              options={MARKET_CATEGORIES.map((category) => ({
                value: category,
                label: CATEGORY_LABELS[category],
              }))}
              selected={browseFilters.categories}
              onToggle={toggleBrowseCategory}
            />
          </div>
        </div>

        <div>
          <p className="text-xs font-semibold text-white/70">Region</p>
          <div className="mt-2">
            <MultiSelect
              label="Region filter"
              allLabel="All regions"
              options={MARKET_CONTINENTS.map((region) => ({
                value: region,
                label: region,
              }))}
              selected={browseFilters.regions}
              onToggle={toggleBrowseRegion}
            />
          </div>
        </div>
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
          onChange={(event) => {
            const sort = event.target.value as MarketSort
            updateBrowseFilters({
              sort,
              sortDirection: DEFAULT_SORT_DIRECTIONS[sort],
            })
          }}
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
        <button
          type="button"
          onClick={() =>
            updateBrowseFilters({
              sortDirection:
                browseFilters.sortDirection === "asc" ? "desc" : "asc",
            })
          }
          aria-label={isReversedOrder ? "Restore order" : "Reverse order"}
          aria-pressed={isReversedOrder}
          title={isReversedOrder ? "Restore order" : "Reverse order"}
          className="grid size-10 place-items-center text-white/70 transition hover:text-white"
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            className={`size-4 transition ${isReversedOrder ? "rotate-180" : ""}`}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 5v14" />
            <path d="m5 12 7-7 7 7" />
          </svg>
        </button>
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
