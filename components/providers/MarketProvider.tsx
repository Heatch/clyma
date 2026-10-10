"use client"

import {
  createContext,
  useCallback,
  useContext,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"

import { useSolanaWallet } from "@/components/providers/SolanaProvider"
import {
  calculateImpliedProbabilities,
  lamportsToSolNumber,
} from "@/lib/markets/calculations"
import type {
  ClimateMarket,
  MarketCategory,
  MarketHistoryPoint,
  MarketStatus,
  TradeConfirmedDetail,
} from "@/lib/markets/types"
import { TRADE_CONFIRMED_EVENT } from "@/lib/markets/types"
import { decodeMarketAccount } from "@/lib/solana/accounts"
import { SOLANA_COMMITMENT, SOLANA_PROGRAM_ID } from "@/lib/solana/config"
import { deriveMarketPda, deriveProtocolConfigPda } from "@/lib/solana/pdas"

export type MarketSort = "trending" | "volume" | "closing" | "yes" | "category"
export type StatusFilter = MarketStatus | "all"

type MarketContextValue = {
  markets: ClimateMarket[]
  visibleMarkets: ClimateMarket[]
  boardMarkets: ClimateMarket[]
  selectedRegion: string | null
  selectedMarket: ClimateMarket | null
  clusterMarkets: ClimateMarket[] | null
  isDrawerOpen: boolean
  isPortfolioMode: boolean
  detailReturnView: "portfolio" | "region" | "cluster" | null
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
  selectMarket: (
    market: ClimateMarket,
    source?: "portfolio" | "region" | "cluster",
  ) => void
  selectCluster: (markets: ClimateMarket[]) => void
  showRegionMarkets: () => void
  showClusterMarkets: () => void
  showPortfolio: () => void
  closeDrawer: () => void
}

const MarketContext = createContext<MarketContextValue | null>(null)
const MARKET_REFRESH_EVENT = "terraform:market-state-changed"

interface OptimisticPoint {
  timestamp: string
  yesProbability: number
  noProbability: number
}

/**
 * Re-applies confirmed-trade points on top of any market snapshot. Chain
 * refreshes rebuild state from the catalog (wiping in-flight points), so
 * this keeps the chart bent in-session. Pools and volumes are chain-owned
 * and intentionally untouched here — only history and headline odds.
 */
function withOptimisticPoints(
  market: ClimateMarket,
  points: OptimisticPoint[],
): ClimateMarket {
  if (points.length === 0) return market
  const history: MarketHistoryPoint[] = [
    ...market.history,
    ...points.map((point) => ({
      timestamp: point.timestamp,
      yesProbability: point.yesProbability,
      noProbability: point.noProbability,
      totalVolume: market.totalVolume,
      yesLiquidity: market.yesLiquidity,
      noLiquidity: market.noLiquidity,
    })),
  ]
  const last = points[points.length - 1]!
  return {
    ...market,
    history,
    yesPrice: last.yesProbability,
    noPrice: last.noProbability,
  }
}

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
  const { connection } = useSolanaWallet()
  // Treat the server payload as initial state. Keeping this catalog stable lets
  // on-chain refreshes enrich the same market set without restarting whenever
  // a parent happens to pass a newly allocated array.
  const [marketCatalog] = useState<ClimateMarket[]>(() =>
    initialMarkets && initialMarkets.length > 0 ? initialMarkets : [],
  )
  const [markets, setMarkets] = useState<ClimateMarket[]>(() =>
    marketCatalog.map((market) => ({
      ...market,
      chainState: SOLANA_PROGRAM_ID ? "loading" : "unconfigured",
    })),
  )
  const [selectedRegion, setSelectedRegion] = useState<string | null>(null)
  const [selectedMarket, setSelectedMarket] = useState<ClimateMarket | null>(
    null,
  )
  const [clusterMarkets, setClusterMarkets] = useState<ClimateMarket[] | null>(
    null,
  )
  const [isDrawerOpen, setIsDrawerOpen] = useState(false)
  const [isPortfolioMode, setIsPortfolioMode] = useState(false)
  const [detailReturnView, setDetailReturnView] = useState<
    "portfolio" | "region" | "cluster" | null
  >(null)
  const [search, setSearch] = useState("")
  const [category, setCategory] = useState<MarketCategory | "all">("all")
  const [status, setStatus] = useState<StatusFilter>("all")
  const [sort, setSort] = useState<MarketSort>("trending")
  const [isLoading, setIsLoading] = useState(true)
  const refreshRequestRef = useRef(0)
  // Reference "now" resolved after mount (never during render) so time-based
  // card tags like "Closing soon" stay pure and hydration-safe.
  const [now, setNow] = useState(0)
  // Confirmed-trade points awaiting chain confirmation. Re-applied on top of
  // every chain refresh so the chart stays bent in-session.
  const optimisticRef = useRef(new Map<string, OptimisticPoint[]>())

  const refreshOnchainMarkets = useCallback(async () => {
    const requestId = ++refreshRequestRef.current
    const programId = SOLANA_PROGRAM_ID
    if (!programId) {
      if (requestId !== refreshRequestRef.current) return
      setMarkets(
        marketCatalog.map((market) => ({
          ...market,
          chainState: "unconfigured" as const,
        })),
      )
      return
    }

    const addresses = marketCatalog.map(
      (market) => deriveMarketPda(programId, market.onchainMarketId)[0],
    )
    const [protocolAddress] = deriveProtocolConfigPda(programId)

    try {
      const accounts = await connection.getMultipleAccountsInfo(addresses, SOLANA_COMMITMENT)
      if (requestId !== refreshRequestRef.current) return
      setMarkets(
        marketCatalog.map((market, index) => {
          const account = accounts[index]
          if (!account) return { ...market, chainState: "missing" as const }
          if (!account.owner.equals(programId)) {
            return { ...market, chainState: "error" as const }
          }

          try {
            const decoded = decodeMarketAccount(account.data)
            if (
              decoded.marketId !== BigInt(market.onchainMarketId) ||
              !decoded.protocol.equals(protocolAddress) ||
              decoded.totalYesAmount + decoded.totalNoAmount !==
                decoded.totalPoolAmount ||
              (decoded.status === "resolved" &&
                decoded.outcome === "unresolved") ||
              (decoded.status !== "resolved" &&
                decoded.outcome !== "unresolved")
            ) {
              return { ...market, chainState: "error" as const }
            }
            const probabilities = calculateImpliedProbabilities(
              decoded.totalYesAmount,
              decoded.totalNoAmount,
            )
            const closeTime = new Date(
              Number(decoded.closeTimestamp) * 1_000,
            ).toISOString()
            const resolutionTime = new Date(
              Number(decoded.resolutionTimestamp) * 1_000,
            ).toISOString()

            return {
              ...market,
              closeTime,
              resolutionTime,
              status: decoded.status,
              outcome:
                decoded.status === "cancelled"
                  ? ("cancelled" as const)
                  : decoded.outcome,
              yesPrice: probabilities.yes,
              noPrice: probabilities.no,
              yesLiquidity: lamportsToSolNumber(decoded.totalYesAmount),
              noLiquidity: lamportsToSolNumber(decoded.totalNoAmount),
              resolver: decoded.resolver.toBase58(),
              chainState: "synced" as const,
              chainYesLamports: decoded.totalYesAmount.toString(),
              chainNoLamports: decoded.totalNoAmount.toString(),
              chainTotalLamports: decoded.totalPoolAmount.toString(),
            }
          } catch {
            return { ...market, chainState: "error" as const }
          }
        }).map((market) =>
          withOptimisticPoints(
            market,
            optimisticRef.current.get(market.id) ?? [],
          ),
        ),
      )
    } catch {
      if (requestId !== refreshRequestRef.current) return
      setMarkets((current) =>
        current.map((market) => ({ ...market, chainState: "error" })),
      )
    }
  }, [connection, marketCatalog])

  // Flip off after the first client commit so board/card skeletons show during
  // hydration and swap seamlessly to content (and stay ready for async data).
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setIsLoading(false)
      setNow(Date.now())
    })
    return () => window.cancelAnimationFrame(frame)
  }, [])

  useEffect(() => {
    void refreshOnchainMarkets()
    if (!SOLANA_PROGRAM_ID) return

    const refresh = () => void refreshOnchainMarkets()
    const interval = window.setInterval(refresh, 30_000)
    window.addEventListener(MARKET_REFRESH_EVENT, refresh)
    return () => {
      window.clearInterval(interval)
      window.removeEventListener(MARKET_REFRESH_EVENT, refresh)
    }
  }, [refreshOnchainMarkets])

  // Optimistic post-trade feedback: append the confirmed point immediately so
  // the chart bends without waiting for the next chain refresh (which
  // re-applies the same points on top of fresh chain state).
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<TradeConfirmedDetail>).detail
      if (!detail) return
      const point: OptimisticPoint = {
        timestamp: new Date().toISOString(),
        yesProbability: detail.yesProbabilityAfter,
        noProbability: detail.noProbabilityAfter,
      }
      const kept = [
        ...(optimisticRef.current.get(detail.marketId) ?? []),
        point,
      ].slice(-50)
      optimisticRef.current.set(detail.marketId, kept)
      setMarkets((current) =>
        current.map((market) =>
          market.id === detail.marketId
            ? withOptimisticPoints(market, [point])
            : market,
        ),
      )
    }
    window.addEventListener(TRADE_CONFIRMED_EVENT, handler)
    return () => window.removeEventListener(TRADE_CONFIRMED_EVENT, handler)
  }, [])

  useEffect(() => {
    setSelectedMarket((current) =>
      current
        ? (markets.find((market) => market.id === current.id) ?? current)
        : null,
    )
  }, [markets])

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
    setClusterMarkets(null)
    setDetailReturnView(null)
    setIsDrawerOpen(true)
  }, [])

  const selectMarket = useCallback(
    (market: ClimateMarket, source: "portfolio" | "region" | "cluster" = "region") => {
      setSelectedRegion(market.continent)
      setSelectedMarket(market)
      setIsPortfolioMode(false)
      if (source !== "cluster") setClusterMarkets(null)
      setDetailReturnView(source === "portfolio" ? "portfolio" : source)
      setIsDrawerOpen(true)
    },
    [],
  )

  const selectCluster = useCallback((markets: ClimateMarket[]) => {
    setClusterMarkets(markets)
    setSelectedMarket(null)
    setSelectedRegion(null)
    setIsPortfolioMode(false)
    setDetailReturnView("cluster")
    setIsDrawerOpen(true)
  }, [])

  const showRegionMarkets = useCallback(() => {
    setSelectedMarket(null)
    setClusterMarkets(null)
    setIsPortfolioMode(false)
    setDetailReturnView(null)
  }, [])
  const showClusterMarkets = useCallback(() => {
    setSelectedMarket(null)
    setIsPortfolioMode(false)
    setDetailReturnView("cluster")
  }, [])
  const showPortfolio = useCallback(() => {
    setSelectedMarket(null)
    setClusterMarkets(null)
    setIsPortfolioMode(true)
    setDetailReturnView(null)
    setIsDrawerOpen(true)
  }, [])
  const closeDrawer = useCallback(() => {
    setIsDrawerOpen(false)
    setSelectedMarket(null)
    setSelectedRegion(null)
    setClusterMarkets(null)
    setIsPortfolioMode(false)
    setDetailReturnView(null)
  }, [])

  const value = useMemo<MarketContextValue>(
    () => ({
      markets,
      visibleMarkets,
      boardMarkets,
      selectedRegion,
      selectedMarket,
      clusterMarkets,
      isDrawerOpen,
      isPortfolioMode,
      detailReturnView,
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
      selectCluster,
      showRegionMarkets,
      showClusterMarkets,
      showPortfolio,
      closeDrawer,
    }),
    [
      boardMarkets,
      category,
      closeDrawer,
      clusterMarkets,
      isDrawerOpen,
      isPortfolioMode,
      detailReturnView,
      isLoading,
      markets,
      now,
      search,
      selectedMarket,
      selectedRegion,
      selectCluster,
      selectMarket,
      selectRegion,
      showClusterMarkets,
      showRegionMarkets,
      showPortfolio,
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
