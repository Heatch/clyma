"use client"

import { useMemo } from "react"

import { usePositions } from "@/components/providers/PositionProvider"
import { useSolanaWallet } from "@/components/providers/SolanaProvider"
import useMarketProgram from "@/hooks/useMarketProgram"
import type { ClimateMarket } from "@/lib/markets/types"
import { formatSol } from "@/lib/utils/format"

export default function RedeemPosition({ market }: { market: ClimateMarket }) {
  const { connected } = useSolanaWallet()
  const { positions, updateMarketSettlement } = usePositions()
  const { claim, refund, state, isPending, isConfigured } =
    useMarketProgram(market)
  const marketPositions = useMemo(
    () => positions.filter((position) => position.marketId === market.id),
    [market.id, positions],
  )
  const eligiblePosition = marketPositions.find((position) => {
    if (["claimed", "refunded"].includes(position.status)) return false
    if (isConfigured && position.source !== "onchain") return false
    if (market.status === "cancelled") {
      return isConfigured
        ? position.status === "refundable"
        : position.status === "refundable" || position.status === "open"
    }
    return (
      market.status === "resolved" &&
      market.outcome === position.side &&
      (isConfigured
        ? position.status === "claimable"
        : position.status === "claimable" || position.status === "open")
    )
  })

  if (market.status !== "resolved" && market.status !== "cancelled") return null

  const isRefund = market.status === "cancelled"
  const actionLabel = isRefund
    ? "Refund cancelled position"
    : "Claim winning payout"
  const chainUnavailable = isConfigured && market.chainState !== "synced"

  const redeem = async () => {
    if (!eligiblePosition || isPending) return
    try {
      const result = isRefund ? await refund() : await claim()
      updateMarketSettlement(
        market.id,
        isRefund ? "refund" : "claim",
        market.outcome === "yes" || market.outcome === "no"
          ? market.outcome
          : null,
        result.signature,
      )
    } catch {
      // The program hook exposes a mapped, user-safe error below.
    }
  }

  return (
    <section
      className="mt-4 rounded-2xl border border-ink bg-neutral-100 p-4"
      aria-labelledby="redeem-heading"
    >
      <p className="eyebrow">Settlement available</p>
      <h3 id="redeem-heading" className="mt-1 text-base font-semibold">
        {isRefund
          ? "Market cancelled"
          : `${market.outcome.toUpperCase()} resolved`}
      </h3>
      {eligiblePosition ? (
        <>
          <p className="mt-2 text-xs leading-5 text-neutral-600">
            {isRefund
              ? `Your original ${formatSol(eligiblePosition.amountSol, 4)} deposit can be refunded from the program vault.`
              : `Your ${eligiblePosition.side.toUpperCase()} position is eligible for its proportional share of the final pool.`}
          </p>
          <button
            type="button"
            onClick={() => void redeem()}
            disabled={
              !connected || !isConfigured || chainUnavailable || isPending
            }
            className="mt-3 h-10 w-full rounded-full bg-ink px-4 text-xs font-bold text-white hover:bg-neutral-800 disabled:bg-neutral-300 disabled:text-neutral-500"
          >
            {isPending ? "Submitting settlement…" : actionLabel}
          </button>
          {chainUnavailable && (
            <p className="mt-2 text-[10px] text-neutral-500" role="status">
              Settlement stays disabled until this market account is verified on
              Devnet.
            </p>
          )}
        </>
      ) : (
        <p className="mt-2 text-xs leading-5 text-neutral-600">
          {connected
            ? isConfigured
              ? "No eligible position was verified in this wallet's program accounts."
              : "No eligible locally indexed position was found for this wallet."
            : "Connect the wallet that owns the position to continue."}
        </p>
      )}
      {state.status === "success" && state.explorerUrl && (
        <a
          href={state.explorerUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-3 inline-block text-xs font-bold underline underline-offset-2"
        >
          Settlement confirmed · Explorer ↗
        </a>
      )}
      {state.status === "error" && state.error && (
        <p className="mt-3 text-xs font-semibold" role="alert">
          {state.error.message}
        </p>
      )}
    </section>
  )
}
