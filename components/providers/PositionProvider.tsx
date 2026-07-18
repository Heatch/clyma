"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"

import { useMarkets } from "@/components/providers/MarketProvider"
import { useSolanaWallet } from "@/components/providers/SolanaProvider"
import {
  calculatePayoutLamports,
  lamportsToSolNumber,
} from "@/lib/markets/calculations"
import type { TradeSide } from "@/lib/markets/types"
import {
  decodeClaimRecordAccount,
  decodePositionAccount,
} from "@/lib/solana/accounts"
import { SOLANA_COMMITMENT, SOLANA_PROGRAM_ID } from "@/lib/solana/config"
import {
  deriveClaimRecordPda,
  deriveMarketPda,
  derivePositionPda,
} from "@/lib/solana/pdas"

export interface IndexedPosition {
  id: string
  wallet: string
  marketId: string
  marketQuestion: string
  region: string
  side: TradeSide
  amountSol: number
  estimatedPayoutSol: number
  signature: string | null
  status: "open" | "claimable" | "claimed" | "refundable" | "refunded" | "lost"
  source: "browser" | "onchain"
  createdAt: string
}

type PositionContextValue = {
  positions: IndexedPosition[]
  recordPurchase: (
    position: Omit<
      IndexedPosition,
      "id" | "wallet" | "status" | "source" | "createdAt"
    >,
  ) => void
  updatePositionStatus: (
    id: string,
    status: IndexedPosition["status"],
    signature?: string,
  ) => void
  updateMarketSettlement: (
    marketId: string,
    kind: "claim" | "refund",
    winningSide: TradeSide | null,
    signature: string,
  ) => void
}

const PositionContext = createContext<PositionContextValue | null>(null)
const STORAGE_PREFIX = "terraform:devnet:positions:"
const LEGACY_STORAGE_PREFIX = "klashi:devnet:positions:"
const POSITION_STATUSES = new Set<IndexedPosition["status"]>([
  "open",
  "claimable",
  "claimed",
  "refundable",
  "refunded",
  "lost",
])

function parseStoredPositions(
  value: string | null,
  expectedWallet: string,
): IndexedPosition[] {
  if (!value) return []
  try {
    const parsed: unknown = JSON.parse(value)
    if (!Array.isArray(parsed)) return []
    return parsed.flatMap((value): IndexedPosition[] => {
      if (typeof value !== "object" || value === null) return []
      const item = value as Record<string, unknown>
      if (
        typeof item.id !== "string" ||
        item.wallet !== expectedWallet ||
        typeof item.marketId !== "string" ||
        typeof item.marketQuestion !== "string" ||
        typeof item.region !== "string" ||
        (item.side !== "yes" && item.side !== "no") ||
        typeof item.amountSol !== "number" ||
        !Number.isFinite(item.amountSol) ||
        item.amountSol < 0 ||
        typeof item.estimatedPayoutSol !== "number" ||
        !Number.isFinite(item.estimatedPayoutSol) ||
        item.estimatedPayoutSol < 0 ||
        (typeof item.signature !== "string" && item.signature !== null) ||
        typeof item.status !== "string" ||
        !POSITION_STATUSES.has(item.status as IndexedPosition["status"]) ||
        typeof item.createdAt !== "string" ||
        !Number.isFinite(Date.parse(item.createdAt))
      ) {
        return []
      }

      return [
        {
          id: item.id,
          wallet: expectedWallet,
          marketId: item.marketId,
          marketQuestion: item.marketQuestion,
          region: item.region,
          side: item.side,
          amountSol: item.amountSol,
          estimatedPayoutSol: item.estimatedPayoutSol,
          signature: item.signature,
          status: item.status as IndexedPosition["status"],
          source: item.source === "onchain" ? "onchain" : "browser",
          createdAt: item.createdAt,
        },
      ]
    })
  } catch {
    return []
  }
}

export function PositionProvider({ children }: { children: React.ReactNode }) {
  const { connection, publicKey } = useSolanaWallet()
  const { markets } = useMarkets()
  const wallet = publicKey?.toBase58() ?? null
  const [positions, setPositions] = useState<IndexedPosition[]>([])
  const walletRef = useRef(wallet)
  const refreshRequestRef = useRef(0)

  useEffect(() => {
    walletRef.current = wallet
    refreshRequestRef.current += 1
    if (!wallet) {
      setPositions([])
      return
    }
    const storageKey = `${STORAGE_PREFIX}${wallet}`
    const currentValue = window.localStorage.getItem(storageKey)
    const storedValue =
      currentValue ??
      window.localStorage.getItem(`${LEGACY_STORAGE_PREFIX}${wallet}`)
    const storedPositions = parseStoredPositions(storedValue, wallet)
    setPositions(storedPositions)
    if (currentValue === null && storedPositions.length > 0) {
      window.localStorage.setItem(storageKey, JSON.stringify(storedPositions))
    }
  }, [wallet])

  const persist = useCallback(
    (update: (current: IndexedPosition[]) => IndexedPosition[]) => {
      setPositions((current) => {
        if (!wallet || walletRef.current !== wallet) return current
        const nextPositions = update(current)
        window.localStorage.setItem(
          `${STORAGE_PREFIX}${wallet}`,
          JSON.stringify(nextPositions),
        )
        return nextPositions
      })
    },
    [wallet],
  )

  const recordPurchase = useCallback(
    (
      position: Omit<
        IndexedPosition,
        "id" | "wallet" | "status" | "source" | "createdAt"
      >,
    ) => {
      if (!wallet || walletRef.current !== wallet) return
      persist((current) => {
        const existing = current.find(
          (item) =>
            item.marketId === position.marketId &&
            item.side === position.side &&
            !["claimed", "refunded", "lost"].includes(item.status),
        )
        const amountSol = (existing?.amountSol ?? 0) + position.amountSol
        const market = markets.find((item) => item.id === position.marketId)
        const selectedPool = market
          ? position.side === "yes"
            ? market.yesLiquidity
            : market.noLiquidity
          : 0
        const nextTotalPool = market
          ? market.yesLiquidity + market.noLiquidity + position.amountSol
          : 0
        const nextSelectedPool = selectedPool + position.amountSol
        const estimatedPayoutSol =
          market?.chainState === "synced" && nextSelectedPool > 0
            ? (amountSol * nextTotalPool) / nextSelectedPool
            : position.estimatedPayoutSol
        const nextPosition: IndexedPosition = {
          ...position,
          id: `${position.marketId}:${position.side}`,
          wallet,
          status: "open",
          source: "browser",
          amountSol,
          estimatedPayoutSol,
          createdAt: existing?.createdAt ?? new Date().toISOString(),
        }
        return [
          nextPosition,
          ...current.filter(
            (item) =>
              !(
                item.marketId === nextPosition.marketId &&
                item.side === nextPosition.side
              ),
          ),
        ]
      })
    },
    [markets, persist, wallet],
  )

  const updatePositionStatus = useCallback(
    (id: string, status: IndexedPosition["status"], signature?: string) => {
      persist((current) =>
        current.map((position) =>
          position.id === id
            ? {
                ...position,
                status,
                signature: signature ?? position.signature,
              }
            : position,
        ),
      )
    },
    [persist],
  )

  const updateMarketSettlement = useCallback(
    (
      marketId: string,
      kind: "claim" | "refund",
      winningSide: TradeSide | null,
      signature: string,
    ) => {
      persist((current) =>
        current.map((position) => {
          if (position.marketId !== marketId) return position
          if (kind === "refund") {
            return { ...position, status: "refunded", signature }
          }
          return {
            ...position,
            status:
              position.side === winningSide
                ? ("claimed" as const)
                : ("lost" as const),
            signature,
          }
        }),
      )
    },
    [persist],
  )

  const refreshOnchainPositions = useCallback(async () => {
    const programId = SOLANA_PROGRAM_ID
    if (!wallet || !publicKey || !programId) return
    const requestId = ++refreshRequestRef.current
    const requestWallet = wallet
    const syncedMarkets = markets.filter(
      (market) => market.chainState === "synced",
    )
    if (syncedMarkets.length === 0) return

    const addressSets = syncedMarkets.map((market) => {
      const [marketAddress] = deriveMarketPda(programId, market.onchainMarketId)
      return {
        market,
        marketAddress,
        yesPosition: derivePositionPda(
          programId,
          marketAddress,
          publicKey,
          "yes",
        )[0],
        noPosition: derivePositionPda(
          programId,
          marketAddress,
          publicKey,
          "no",
        )[0],
        claimRecord: deriveClaimRecordPda(
          programId,
          marketAddress,
          publicKey,
        )[0],
      }
    })

    try {
      const accounts = await connection.getMultipleAccountsInfo(
        addressSets.flatMap((item) => [
          item.yesPosition,
          item.noPosition,
          item.claimRecord,
        ]),
        SOLANA_COMMITMENT,
      )
      if (
        requestId !== refreshRequestRef.current ||
        walletRef.current !== requestWallet
      ) {
        return
      }

      setPositions((current) => {
        if (
          requestId !== refreshRequestRef.current ||
          walletRef.current !== requestWallet
        ) {
          return current
        }

        try {
          const onchainPositions: IndexedPosition[] = []
          for (const [index, addresses] of addressSets.entries()) {
            const yesInfo = accounts[index * 3]
            const noInfo = accounts[index * 3 + 1]
            const claimInfo = accounts[index * 3 + 2]
            const claim =
              claimInfo && claimInfo.owner.equals(programId)
                ? decodeClaimRecordAccount(claimInfo.data)
                : null
            if (
              claim &&
              (!claim.market.equals(addresses.marketAddress) ||
                !claim.owner.equals(publicKey))
            ) {
              throw new Error("Claim record ownership does not match its PDA.")
            }

            for (const [side, account] of [
              ["yes", yesInfo],
              ["no", noInfo],
            ] as const) {
              if (!account || !account.owner.equals(programId)) continue
              const decoded = decodePositionAccount(account.data)
              if (
                decoded.amount === 0n ||
                decoded.side !== side ||
                !decoded.market.equals(addresses.marketAddress) ||
                !decoded.owner.equals(publicKey)
              ) {
                continue
              }

              const cached = current.find(
                (position) =>
                  position.marketId === addresses.market.id &&
                  position.side === side,
              )
              const sidePoolLamports = BigInt(
                side === "yes"
                  ? (addresses.market.chainYesLamports ?? "0")
                  : (addresses.market.chainNoLamports ?? "0"),
              )
              const totalPoolLamports = BigInt(
                addresses.market.chainTotalLamports ?? "0",
              )
              const estimatedPayoutLamports =
                sidePoolLamports > 0n
                  ? calculatePayoutLamports(
                      decoded.amount,
                      totalPoolLamports,
                      sidePoolLamports,
                    )
                  : 0n
              const status = (() => {
                if (claim?.claimed) {
                  if (claim.kind === "refund") return "refunded" as const
                  return addresses.market.outcome === side
                    ? ("claimed" as const)
                    : ("lost" as const)
                }
                if (addresses.market.status === "cancelled") {
                  return "refundable" as const
                }
                if (addresses.market.status === "resolved") {
                  return addresses.market.outcome === side
                    ? ("claimable" as const)
                    : ("lost" as const)
                }
                return "open" as const
              })()

              onchainPositions.push({
                id: `${addresses.market.id}:${side}`,
                wallet,
                marketId: addresses.market.id,
                marketQuestion: addresses.market.question,
                region: addresses.market.region,
                side,
                amountSol: lamportsToSolNumber(decoded.amount),
                estimatedPayoutSol: lamportsToSolNumber(
                  estimatedPayoutLamports,
                ),
                signature: cached?.signature ?? null,
                status,
                source: "onchain",
                createdAt: cached?.createdAt ?? new Date().toISOString(),
              })
            }
          }

          const syncedIds = new Set(syncedMarkets.map((market) => market.id))
          return [
            ...onchainPositions,
            ...current.filter((position) => !syncedIds.has(position.marketId)),
          ]
        } catch {
          return current
        }
      })
    } catch {
      // Keep the last successfully reconciled browser view when RPC is down.
    }
  }, [connection, markets, publicKey, wallet])

  useEffect(() => {
    void refreshOnchainPositions()
  }, [refreshOnchainPositions])

  const value = useMemo(
    () => ({
      positions,
      recordPurchase,
      updatePositionStatus,
      updateMarketSettlement,
    }),
    [positions, recordPurchase, updateMarketSettlement, updatePositionStatus],
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
