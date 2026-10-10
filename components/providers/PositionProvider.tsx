"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react"

import { useSolanaWallet } from "@/components/providers/SolanaProvider"
import { useMarkets } from "@/components/providers/MarketProvider"
import type { TradeSide } from "@/lib/markets/types"

export interface IndexedPosition {
  id: string
  wallet: string
  marketId: string
  marketQuestion: string
  region: string
  side: TradeSide
  amountSol: number
  estimatedPayoutSol: number
  signature: string
  status: "open" | "claimable" | "claimed" | "refundable" | "refunded" | "lost"
  createdAt: string
  settledAt?: string
}

type PositionContextValue = {
  positions: IndexedPosition[]
  isFetching: boolean
  recordPurchase: (
    position: Omit<IndexedPosition, "id" | "wallet" | "status" | "createdAt">,
  ) => void
  updatePositionStatus: (
    id: string,
    status: IndexedPosition["status"],
    signature?: string,
  ) => void
  fetchRemotePositions: () => Promise<void>
}

const PositionContext = createContext<PositionContextValue | null>(null)
const STORAGE_PREFIX = "klashi:devnet:positions:"

function parseStoredPositions(value: string | null): IndexedPosition[] {
  if (!value) return []
  try {
    const parsed: unknown = JSON.parse(value)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (item): item is IndexedPosition =>
        typeof item === "object" &&
        item !== null &&
        "id" in item &&
        "wallet" in item &&
        "marketId" in item &&
        "signature" in item,
    )
  } catch {
    return []
  }
}

export function PositionProvider({ children }: { children: React.ReactNode }) {
  const { publicKey } = useSolanaWallet()
  const wallet = publicKey?.toBase58() ?? null
  const { markets, isLoading: marketsLoading } = useMarkets()
  const [positions, setPositions] = useState<IndexedPosition[]>([])
  const [isFetching, setIsFetching] = useState(false)

  useEffect(() => {
    if (!wallet) {
      setPositions([])
      return
    }
    const stored = parseStoredPositions(
      window.localStorage.getItem(`${STORAGE_PREFIX}${wallet}`),
    )
    setPositions(stored)
  }, [wallet])

  // Drop cached positions whose market is gone from the catalog (e.g.
  // recorded before a reseed replaced all markets) and persist the prune,
  // so stale entries never resurrect on reload. Skipped until the catalog
  // is loaded — an empty list proves nothing.
  useEffect(() => {
    if (marketsLoading || markets.length === 0) return
    const alive = new Set(markets.map((market) => market.id))
    setPositions((current) => {
      if (current.every((position) => alive.has(position.marketId))) {
        return current
      }
      const pruned = current.filter((position) =>
        alive.has(position.marketId),
      )
      if (wallet) {
        window.localStorage.setItem(
          `${STORAGE_PREFIX}${wallet}`,
          JSON.stringify(pruned),
        )
      }
      return pruned
    })
  }, [markets, marketsLoading, wallet])

  const persist = useCallback(
    (nextPositions: IndexedPosition[]) => {
      setPositions(nextPositions)
      if (wallet)
        window.localStorage.setItem(
          `${STORAGE_PREFIX}${wallet}`,
          JSON.stringify(nextPositions),
        )
    },
    [wallet],
  )

  const fetchRemotePositions = useCallback(async () => {
    if (!wallet) return
    setIsFetching(true)
    try {
      const res = await fetch(`/api/users/${wallet}/positions`)
      const json = await res.json()
      if (json.data?.positions) {
        const remote: IndexedPosition[] = json.data.positions.map(
          (p: Record<string, unknown>) => ({
            id: p.id as string,
            wallet: p.wallet as string,
            marketId: p.marketId as string,
            marketQuestion: p.marketQuestion as string,
            region: (p.region as string) ?? "",
            side: p.side as TradeSide,
            amountSol: p.amountSol as number,
            estimatedPayoutSol: p.estimatedPayoutSol as number,
            signature: (p.transactionSignature ?? "") as string,
            status: (p.status as IndexedPosition["status"]) ?? "open",
            createdAt: (p.openedAt as string) ?? new Date().toISOString(),
            settledAt: p.settledAt as string | undefined,
          }),
        )
        const local = parseStoredPositions(
          window.localStorage.getItem(`${STORAGE_PREFIX}${wallet}`),
        )
        const merged = new Map<string, IndexedPosition>()
        for (const p of remote) merged.set(p.id, p)
        for (const p of local) if (!merged.has(p.id)) merged.set(p.id, p)
        persist(Array.from(merged.values()))
      }
    } catch {
      // API unavailable, keep local positions
    } finally {
      setIsFetching(false)
    }
  }, [wallet, persist])

  useEffect(() => {
    if (wallet) fetchRemotePositions()
  }, [wallet, fetchRemotePositions])

  const recordPurchase = useCallback(
    (
      position: Omit<IndexedPosition, "id" | "wallet" | "status" | "createdAt">,
    ) => {
      if (!wallet) return
      const now = new Date().toISOString()
      const nextPosition: IndexedPosition = {
        ...position,
        id: `${position.marketId}:${position.side}:${position.signature}`,
        wallet,
        status: "open",
        createdAt: now,
      }

      // Indexing is the trade form's job (single POST per signature in
      // PredictionForm.submit); this stays a local write so retries and
      // duplicate callers cannot create duplicate positions.
      persist([
        nextPosition,
        ...positions.filter((item) => item.id !== nextPosition.id),
      ])
    },
    [persist, positions, wallet],
  )

  const updatePositionStatus = useCallback(
    (id: string, status: IndexedPosition["status"], signature?: string) => {
      persist(
        positions.map((position) =>
          position.id === id
            ? {
                ...position,
                status,
                signature: signature ?? position.signature,
                settledAt: new Date().toISOString(),
              }
            : position,
        ),
      )
    },
    [persist, positions],
  )

  const value = useMemo(
    () => ({
      positions,
      isFetching,
      recordPurchase,
      updatePositionStatus,
      fetchRemotePositions,
    }),
    [
      positions,
      isFetching,
      recordPurchase,
      updatePositionStatus,
      fetchRemotePositions,
    ],
  )

  return (
    <PositionContext.Provider value={value}>
      {children}
    </PositionContext.Provider>
  )
}

export function usePositions() {
  const value = useContext(PositionContext)
  if (!value)
    throw new Error("usePositions must be used inside PositionProvider")
  return value
}
