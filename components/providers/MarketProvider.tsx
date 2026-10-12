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
import { matchesSearch, searchRelevance } from "@/lib/markets/search"
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

export type MarketSort = "trending" | "volume" | "closing" | "yes"
export type SortDirection = "asc" | "desc"

export interface BrowseFilters {
  query: string
  categories: MarketCategory[]
  regions: string[]
  sort: MarketSort
  sortDirection: SortDirection
}

type MarketContextValue = {
  markets: ClimateMarket[]
  selectedRegion: string | null
  selectedMarket: ClimateMarket | null
  browseFilters: BrowseFilters
  browseScopeIds: string[] | null
  browseResults: ClimateMarket[]
  isDrawerOpen: boolean
  isDrawerClosing: boolean
  isPortfolioMode: boolean
  detailReturnView: "portfolio" | "browse" | null
  isLoading: boolean
  now: number
  updateBrowseFilters: (filters: Partial<BrowseFilters>) => void
  toggleBrowseCategory: (category: MarketCategory) => void
  toggleBrowseRegion: (region: string) => void
  clearBrowseScope: () => void
  resetBrowseFilters: () => void
  selectRegion: (region: string) => void
  selectMarket: (market: ClimateMarket, source?: "portfolio" | "browse") => void
  selectCluster: (markets: ClimateMarket[]) => void
  showBrowse: (options?: { reset?: boolean }) => void
  showPortfolio: () => void
  closeDrawer: () => void
}

const MarketContext = createContext<MarketContextValue | null>(null)
const MARKET_REFRESH_EVENT = "terraform:market-state-changed"
/**
 * Drawer open/close animation length. The globe's viewport transition and
 * the drawer's slide share this duration so both move together.
 */
export const DRAWER_TRANSITION_MS = 520

interface OptimisticPoint {
  timestamp: string
  yesProbability: number
  noProbability: number
  volume: number
}

/**
 * Re-applies confirmed-trade points on top of any market snapshot. Chain
 * refreshes rebuild state from the catalog (wiping in-flight points), so
 * this keeps the chart bent in-session. Pools remain chain-owned; volume is
 * indexed off-chain, so the trade's amount is included here as well.
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
  const optimisticVolume = points.reduce((sum, point) => sum + point.volume, 0)
  return {
    ...market,
    history,
    yesPrice: last.yesProbability,
    noPrice: last.noProbability,
    totalVolume: market.totalVolume + optimisticVolume,
  }
}

const STATUS_ORDER: Record<MarketStatus, number> = {
  open: 0,
  closed: 1,
  resolved: 2,
  cancelled: 3,
}

export const DEFAULT_SORT_DIRECTIONS: Record<MarketSort, SortDirection> = {
  closing: "asc",
  volume: "desc",
  yes: "desc",
  trending: "desc",
}

const DEFAULT_BROWSE_FILTERS: BrowseFilters = {
  query: "",
  categories: [],
  regions: [],
  sort: "closing",
  sortDirection: DEFAULT_SORT_DIRECTIONS.closing,
}

function freshBrowseFilters(): BrowseFilters {
  return {
    ...DEFAULT_BROWSE_FILTERS,
    categories: [],
    regions: [],
  }
}

function comparatorFor(sort: MarketSort, direction: SortDirection) {
  const reverse = <T,>(compare: (first: T, second: T) => number) =>
    direction === DEFAULT_SORT_DIRECTIONS[sort]
      ? compare
      : (first: T, second: T) => -compare(first, second)

  switch (sort) {
    case "volume":
      return reverse(
        (first: ClimateMarket, second: ClimateMarket) =>
          second.totalVolume - first.totalVolume,
      )
    case "closing":
      return reverse(
        (first: ClimateMarket, second: ClimateMarket) =>
          Date.parse(first.closeTime) - Date.parse(second.closeTime),
      )
    case "yes":
      return reverse(
        (first: ClimateMarket, second: ClimateMarket) =>
          second.yesPrice - first.yesPrice,
      )
    case "trending":
    default:
      return reverse(
        (first: ClimateMarket, second: ClimateMarket) =>
          second.trendingScore - first.trendingScore,
      )
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
  const [browseFilters, setBrowseFilters] =
    useState<BrowseFilters>(freshBrowseFilters)
  const [browseScopeIds, setBrowseScopeIds] = useState<string[] | null>(null)
  const [isDrawerOpen, setIsDrawerOpen] = useState(false)
  const [isDrawerClosing, setIsDrawerClosing] = useState(false)
  // Mirrors the open/closing flags for use inside callbacks without stale
  // closures. Every drawer state change below keeps this in sync.
  const drawerStateRef = useRef({ open: false, closing: false })
  const closeTimeoutRef = useRef<number | null>(null)
  const [isPortfolioMode, setIsPortfolioMode] = useState(false)
  const [detailReturnView, setDetailReturnView] = useState<
    "portfolio" | "browse" | null
  >(null)
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
        marketCatalog.map((market) =>
          withOptimisticPoints(
            { ...market, chainState: "unconfigured" as const },
            optimisticRef.current.get(market.id) ?? [],
          ),
        ),
      )
      return
    }

    const addresses = marketCatalog.map(
      (market) => deriveMarketPda(programId, market.onchainMarketId)[0],
    )
    const [protocolAddress] = deriveProtocolConfigPda(programId)

    try {
      const accounts = await connection.getMultipleAccountsInfo(
        addresses,
        SOLANA_COMMITMENT,
      )
      if (requestId !== refreshRequestRef.current) return
      setMarkets(
        marketCatalog
          .map((market, index) => {
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
          })
          .map((market) =>
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
        volume: detail.amountSol,
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

  // Deferring the query keeps the input responsive while the large result
  // list recomputes off the debounced value.
  const deferredQuery = useDeferredValue(browseFilters.query)

  const browseResults = useMemo(() => {
    const scope = browseScopeIds ? new Set(browseScopeIds) : null
    const comparator = comparatorFor(
      browseFilters.sort,
      browseFilters.sortDirection,
    )
    const hasQuery = browseFilters.query.trim().length > 0
    return [...markets]
      .filter(
        (market) =>
          (!scope || scope.has(market.id)) &&
          matchesSearch(market, deferredQuery) &&
          (browseFilters.categories.length === 0 ||
            browseFilters.categories.includes(market.category)) &&
          (browseFilters.regions.length === 0 ||
            browseFilters.regions.includes(market.continent)),
      )
      .sort((first, second) => {
        const statusDelta =
          STATUS_ORDER[first.status] - STATUS_ORDER[second.status]
        if (statusDelta !== 0) return statusDelta
        if (hasQuery) {
          const relevanceDelta =
            searchRelevance(second, deferredQuery) -
            searchRelevance(first, deferredQuery)
          if (relevanceDelta !== 0) return relevanceDelta
        }
        return (
          comparator(first, second) ||
          first.question.localeCompare(second.question)
        )
      })
  }, [browseFilters, browseScopeIds, deferredQuery, markets])

  const updateBrowseFilters = useCallback((filters: Partial<BrowseFilters>) => {
    setBrowseFilters((previous) => ({ ...previous, ...filters }))
  }, [])

  const toggleBrowseCategory = useCallback((category: MarketCategory) => {
    setBrowseFilters((previous) => ({
      ...previous,
      categories: previous.categories.includes(category)
        ? previous.categories.filter((item) => item !== category)
        : [...previous.categories, category],
    }))
  }, [])

  const toggleBrowseRegion = useCallback((region: string) => {
    setBrowseFilters((previous) => ({
      ...previous,
      regions: previous.regions.includes(region)
        ? previous.regions.filter((item) => item !== region)
        : [...previous.regions, region],
    }))
  }, [])

  const clearBrowseScope = useCallback(() => {
    setBrowseScopeIds(null)
  }, [])

  const resetBrowseFilters = useCallback(() => {
    setBrowseFilters(freshBrowseFilters())
    setBrowseScopeIds(null)
  }, [])

  // Marks the drawer open, cancelling a slide-out exit in progress (e.g. a
  // market clicked while the drawer was closing slides back in instead of
  // unmounting).
  const openDrawerState = useCallback(() => {
    if (closeTimeoutRef.current !== null) {
      window.clearTimeout(closeTimeoutRef.current)
      closeTimeoutRef.current = null
    }
    drawerStateRef.current = { open: true, closing: false }
    setIsDrawerClosing(false)
    setIsDrawerOpen(true)
  }, [])

  const finishCloseDrawer = useCallback(() => {
    closeTimeoutRef.current = null
    drawerStateRef.current = { open: false, closing: false }
    setIsDrawerOpen(false)
    setSelectedMarket(null)
    setSelectedRegion(null)
    setBrowseScopeIds(null)
    setIsPortfolioMode(false)
    setDetailReturnView(null)
    setIsDrawerClosing(false)
    resetBrowseFilters()
  }, [resetBrowseFilters])

  const openBrowse = useCallback(
    ({ region, scopeIds }: { region?: string; scopeIds?: string[] }) => {
      setBrowseFilters((previous) => ({
        query: "",
        categories: [],
        regions: region ? [region] : [],
        sort: previous.sort,
        sortDirection: previous.sortDirection,
      }))
      setBrowseScopeIds(scopeIds ? [...scopeIds] : null)
      setSelectedMarket(null)
      setSelectedRegion((previous) => region ?? (scopeIds ? null : previous))
      setIsPortfolioMode(false)
      setDetailReturnView("browse")
      openDrawerState()
    },
    [openDrawerState],
  )

  const selectRegion = useCallback(
    (region: string) => {
      openBrowse({ region })
    },
    [openBrowse],
  )

  const selectMarket = useCallback(
    (market: ClimateMarket, source: "portfolio" | "browse" = "browse") => {
      setSelectedRegion(market.continent)
      setSelectedMarket(market)
      setIsPortfolioMode(false)
      if (source !== "browse") setBrowseScopeIds(null)
      setDetailReturnView(source === "portfolio" ? "portfolio" : "browse")
      openDrawerState()
    },
    [openDrawerState],
  )

  const selectCluster = useCallback(
    (markets: ClimateMarket[]) => {
      openBrowse({ scopeIds: markets.map((market) => market.id) })
    },
    [openBrowse],
  )

  const showBrowse = useCallback(
    (options?: { reset?: boolean }) => {
      setSelectedMarket(null)
      setSelectedRegion(null)
      setIsPortfolioMode(false)
      setDetailReturnView("browse")
      if (options?.reset) resetBrowseFilters()
      openDrawerState()
    },
    [openDrawerState, resetBrowseFilters],
  )
  const showPortfolio = useCallback(() => {
    setSelectedMarket(null)
    setBrowseScopeIds(null)
    setIsPortfolioMode(true)
    setDetailReturnView(null)
    openDrawerState()
  }, [openDrawerState])
  const closeDrawer = useCallback(() => {
    if (!drawerStateRef.current.open || drawerStateRef.current.closing) return
    drawerStateRef.current = { open: true, closing: true }
    setIsDrawerClosing(true)
    if (
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      finishCloseDrawer()
      return
    }
    closeTimeoutRef.current = window.setTimeout(
      finishCloseDrawer,
      DRAWER_TRANSITION_MS,
    )
  }, [finishCloseDrawer])

  useEffect(() => {
    const timeout = closeTimeoutRef
    return () => {
      if (timeout.current !== null) window.clearTimeout(timeout.current)
    }
  }, [])

  const value = useMemo<MarketContextValue>(
    () => ({
      markets,
      selectedRegion,
      selectedMarket,
      browseFilters,
      browseScopeIds,
      browseResults,
      isDrawerOpen,
      isDrawerClosing,
      isPortfolioMode,
      detailReturnView,
      isLoading,
      now,
      updateBrowseFilters,
      toggleBrowseCategory,
      toggleBrowseRegion,
      clearBrowseScope,
      resetBrowseFilters,
      selectRegion,
      selectMarket,
      selectCluster,
      showBrowse,
      showPortfolio,
      closeDrawer,
    }),
    [
      browseFilters,
      browseResults,
      browseScopeIds,
      clearBrowseScope,
      closeDrawer,
      isDrawerClosing,
      isDrawerOpen,
      isPortfolioMode,
      detailReturnView,
      isLoading,
      markets,
      now,
      resetBrowseFilters,
      selectedMarket,
      selectedRegion,
      selectCluster,
      selectMarket,
      selectRegion,
      showBrowse,
      showPortfolio,
      toggleBrowseCategory,
      toggleBrowseRegion,
      updateBrowseFilters,
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
