"use client"

import {
  createContext,
  useCallback,
  useContext,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
} from "react"

import { demoMarkets } from "@/lib/markets/data"
import type {
  ClimateMarket,
  MarketCategory,
  MarketStatus,
} from "@/lib/markets/types"

export type MarketSort = "trending" | "volume" | "closing" | "yes" | "category"
export type StatusFilter = MarketStatus | "all"

type MarketContextValue = {
  markets: ClimateMarket[]
  visibleMarkets: ClimateMarket[]
  boardMarkets: ClimateMarket[]
  selectedRegion: string | null
  selectedMarket: ClimateMarket | null
  isDrawerOpen: boolean
  isLoading: boolean
  now: number
  search: string
  category: MarketCategory | "all"
  status: StatusFilter
  sort: MarketSort
  setSearch: (value: string) => void
  setCategory: (value: MarketCategory | "all") => void
  setStatus: (value: StatusFilter) => void
  setSort: (value: MarketSort) => void
  selectRegion: (region: string) => void
  selectMarket: (market: ClimateMarket) => void
  showRegionMarkets: () => void
  closeDrawer: () => void
}

const MarketContext = createContext<MarketContextValue | null>(null)

const STATUS_ORDER: Record<MarketStatus, number> = {
  open: 0,
  closed: 1,
  resolved: 2,
  cancelled: 3,
}

function matchesSearch(market: ClimateMarket, search: string) {
  const normalized = search.trim().toLocaleLowerCase()
  if (!normalized) return true
  return [
    market.question,
    market.description,
    market.region,
    market.country,
    market.continent,
    market.category,
  ]
    .filter((value): value is string => Boolean(value))
    .some((value) => value.toLocaleLowerCase().includes(normalized))
}

function comparatorFor(sort: MarketSort) {
  switch (sort) {
    case "volume":
      return (first: ClimateMarket, second: ClimateMarket) =>
        second.totalVolume - first.totalVolume
    case "closing":
      return (first: ClimateMarket, second: ClimateMarket) =>
        Date.parse(first.closeTime) - Date.parse(second.closeTime)
    case "yes":
      return (first: ClimateMarket, second: ClimateMarket) =>
        second.yesPrice - first.yesPrice
    case "trending":
    case "category":
    default:
      return (first: ClimateMarket, second: ClimateMarket) =>
        second.trendingScore - first.trendingScore
  }
}

export function MarketProvider({
  children,
  initialMarkets,
}: {
  children: React.ReactNode
  initialMarkets?: ClimateMarket[]
}) {
  const [selectedRegion, setSelectedRegion] = useState<string | null>(null)
  const [selectedMarket, setSelectedMarket] = useState<ClimateMarket | null>(
    null,
  )
  const [isDrawerOpen, setIsDrawerOpen] = useState(false)
  const [search, setSearch] = useState("")
  const [category, setCategory] = useState<MarketCategory | "all">("all")
  const [status, setStatus] = useState<StatusFilter>("all")
  const [sort, setSort] = useState<MarketSort>("trending")
  const [isLoading, setIsLoading] = useState(true)
  // Reference "now" resolved after mount (never during render) so time-based
  // card tags like "Closing soon" stay pure and hydration-safe.
  const [now, setNow] = useState(0)

  // Flip off after the first client commit so board/card skeletons show during
  // hydration and swap seamlessly to content (and stay ready for async data).
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setIsLoading(false)
      setNow(Date.now())
    })
    return () => window.cancelAnimationFrame(frame)
  }, [])

  // Server-generated markets (Gemini) when provided; otherwise bundled samples.
  const markets = useMemo(
    () =>
      initialMarkets && initialMarkets.length > 0
        ? initialMarkets
        : demoMarkets,
    [initialMarkets],
  )

  // Deferring search keeps the input responsive while the globe and large
  // market grid recompute off the debounced value.
  const deferredSearch = useDeferredValue(search)

  const visibleMarkets = useMemo(
    () =>
      markets.filter(
        (market) =>
          matchesSearch(market, deferredSearch) &&
          (category === "all" || market.category === category),
      ),
    [category, deferredSearch, markets],
  )

  const boardMarkets = useMemo(() => {
    const filtered =
      status === "all"
        ? visibleMarkets
        : visibleMarkets.filter((market) => market.status === status)
    const comparator = comparatorFor(sort)
    return [...filtered].sort((first, second) => {
      const statusDelta =
        STATUS_ORDER[first.status] - STATUS_ORDER[second.status]
      if (statusDelta !== 0) return statusDelta
      return (
        comparator(first, second) ||
        first.question.localeCompare(second.question)
      )
    })
  }, [visibleMarkets, status, sort])

  const selectRegion = useCallback((region: string) => {
    setSelectedRegion(region)
    setSelectedMarket(null)
    setIsDrawerOpen(true)
  }, [])

  const selectMarket = useCallback((market: ClimateMarket) => {
    setSelectedRegion(market.continent)
    setSelectedMarket(market)
    setIsDrawerOpen(true)
  }, [])

  const showRegionMarkets = useCallback(() => setSelectedMarket(null), [])
  const closeDrawer = useCallback(() => setIsDrawerOpen(false), [])

  const value = useMemo<MarketContextValue>(
    () => ({
      markets,
      visibleMarkets,
      boardMarkets,
      selectedRegion,
      selectedMarket,
      isDrawerOpen,
      isLoading,
      now,
      search,
      category,
      status,
      sort,
      setSearch,
      setCategory,
      setStatus,
      setSort,
      selectRegion,
      selectMarket,
      showRegionMarkets,
      closeDrawer,
    }),
    [
      boardMarkets,
      category,
      closeDrawer,
      isDrawerOpen,
      isLoading,
      markets,
      now,
      search,
      selectedMarket,
      selectedRegion,
      selectMarket,
      selectRegion,
      showRegionMarkets,
      sort,
      status,
      visibleMarkets,
    ],
  )

  return (
    <MarketContext.Provider value={value}>{children}</MarketContext.Provider>
  )
}

export function useMarkets() {
  const value = useContext(MarketContext)
  if (!value) throw new Error("useMarkets must be used inside MarketProvider")
  return value
}
