"use client"

import Image from "next/image"
import { useEffect } from "react"

import { useMarkets } from "@/components/providers/MarketProvider"
import { usePositions } from "@/components/providers/PositionProvider"
import { useSolanaWallet } from "@/components/providers/SolanaProvider"
import { getExplorerTransactionUrl } from "@/lib/solana/config"
import { formatSol } from "@/lib/utils/format"

const statusLabels: Record<string, string> = {
  open: "Open",
  claimable: "Claimable",
  claimed: "Claimed",
  refundable: "Refundable",
  refunded: "Refunded",
  lost: "Lost",
}

export default function PortfolioPanel() {
  const { connected } = useSolanaWallet()
  const { positions, fetchRemotePositions } = usePositions()
  const { markets, selectMarket } = useMarkets()

  // The panel mounts whenever the portfolio view opens, so fetching here
  // keeps positions current without a manual refresh control.
  useEffect(() => {
    void fetchRemotePositions()
  }, [fetchRemotePositions])

  const totalCommitted = positions.reduce((sum, p) => sum + p.amountSol, 0)
  const totalPotential = positions.reduce(
    (sum, p) => sum + p.estimatedPayoutSol,
    0,
  )
  const settleablePositions = positions.filter(
    (p) => p.status === "claimable" || p.status === "refundable",
  )
  const settleableTotal = settleablePositions.reduce(
    (sum, p) =>
      sum + (p.status === "claimable" ? p.estimatedPayoutSol : p.amountSol),
    0,
  )
  const openPositions = positions.filter((p) => p.status === "open")
  const settledPositions = positions.filter((p) => p.status !== "open")

  return (
    <section aria-label="Positions">
      {!connected ? (
        <div className="mt-5 rounded-2xl border border-dashed border-white/20 bg-white/[0.03] px-5 py-8 text-center">
          <Image
            src="/clyma-logo-shadow.svg"
            alt=""
            aria-hidden="true"
            width={40}
            height={38}
            className="mx-auto h-10 w-auto"
          />
          <p className="mt-3 text-sm font-semibold">Connect a Devnet wallet</p>
          <p className="mx-auto mt-1 max-w-xs text-xs leading-5 text-neutral-400">
            Your confirmed purchases, claims, and refunds will appear here.
          </p>
        </div>
      ) : positions.length === 0 ? (
        <div className="mt-5 rounded-2xl border border-dashed border-white/20 bg-white/[0.03] px-5 py-8 text-center">
          <p className="text-sm font-semibold">No positions yet</p>
          <p className="mt-1 text-xs text-neutral-400">
            Choose a market on the globe and submit a Devnet purchase.
          </p>
        </div>
      ) : (
        <>
          <dl className="mt-5 grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3.5">
              <dt className="text-[9px] font-bold uppercase tracking-wider text-emerald-300">
                Committed
              </dt>
              <dd className="tabular mt-1 text-lg font-semibold text-emerald-100">
                {formatSol(totalCommitted, 3)}
              </dd>
            </div>
            <div className="rounded-xl border border-white/15 bg-white/[0.04] p-3.5">
              <dt className="text-[9px] font-bold uppercase tracking-wider text-neutral-400">
                Potential payout
              </dt>
              <dd className="tabular mt-1 text-lg font-semibold">
                {formatSol(totalPotential, 3)}
              </dd>
            </div>
          </dl>

          {settleablePositions.length > 0 && (
            <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-emerald-400/20 bg-emerald-400/[0.04] p-3">
              <div>
                <p className="text-[9px] font-bold uppercase tracking-wider text-emerald-300">
                  Ready to settle
                </p>
                <p className="tabular mt-0.5 text-sm font-semibold">
                  {formatSol(settleableTotal, 3)} across{" "}
                  {settleablePositions.length} position
                  {settleablePositions.length === 1 ? "" : "s"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  const target = settleablePositions[0]
                  const market =
                    target && markets.find((m) => m.id === target.marketId)
                  if (market) selectMarket(market, "portfolio")
                }}
                className="shrink-0 rounded-full border border-emerald-400/40 bg-emerald-400/15 px-3 py-1.5 text-[11px] font-bold text-emerald-200 transition hover:bg-emerald-400/25"
              >
                Review &amp; claim
              </button>
            </div>
          )}

          {openPositions.length > 0 && (
            <>
              <h3 className="mb-3 mt-6 text-sm font-semibold text-neutral-300">
                Open positions ({openPositions.length})
              </h3>
              <div className="divide-y divide-white/[0.06] rounded-xl border border-white/10 bg-white/[0.03]">
                {openPositions.map((position) => (
                  <PositionRow
                    key={position.id}
                    position={position}
                    markets={markets}
                    selectMarket={selectMarket}
                  />
                ))}
              </div>
            </>
          )}

          {settledPositions.length > 0 && (
            <>
              <h3 className="mb-3 mt-6 text-sm font-semibold text-neutral-400">
                Settled positions ({settledPositions.length})
              </h3>
              <div className="divide-y divide-white/[0.06] rounded-xl border border-white/10 bg-white/[0.03]">
                {settledPositions.slice(0, 10).map((position) => (
                  <PositionRow
                    key={position.id}
                    position={position}
                    markets={markets}
                    selectMarket={selectMarket}
                  />
                ))}
              </div>
            </>
          )}
        </>
      )}

      <p className="mt-4 text-[9px] leading-4 text-neutral-600">
        Positions are indexed from your confirmed Solana transactions and stored
        locally. On-chain program accounts remain the source of truth.
      </p>
    </section>
  )
}

function PositionRow({
  position,
  markets,
  selectMarket,
}: {
  position: ReturnType<typeof usePositions>["positions"][number]
  markets: ReturnType<typeof useMarkets>["markets"]
  selectMarket: ReturnType<typeof useMarkets>["selectMarket"]
}) {
  const market = markets.find((m) => m.id === position.marketId)
  const statusLabel = statusLabels[position.status] ?? position.status

  return (
    <div className="px-5 py-5">
      <button
        type="button"
        disabled={!market}
        onClick={() => market && selectMarket(market, "portfolio")}
        className="line-clamp-2 text-left text-base font-semibold leading-6 text-neutral-100 hover:underline disabled:cursor-default sm:text-lg sm:leading-7"
      >
        {position.marketQuestion}
      </button>
      <div className="mt-3 flex flex-wrap items-center gap-2.5 text-sm">
        <span
          className={
            position.side === "yes"
              ? "rounded border border-emerald-400/40 bg-emerald-400/15 px-2 py-1 text-xs font-bold text-emerald-300"
              : "rounded border border-red-400/40 bg-red-400/15 px-2 py-1 text-xs font-bold text-red-300"
          }
        >
          {position.side.toUpperCase()}
        </span>
        <span className="tabular text-neutral-200">
          {formatSol(position.amountSol, 3)} staked
        </span>
        {position.estimatedPayoutSol > 0 && (
          <span className="tabular text-neutral-400">
            / {formatSol(position.estimatedPayoutSol, 3)} payout
          </span>
        )}
        <span className="ml-auto text-xs font-semibold text-neutral-300">
          {statusLabel}
        </span>
      </div>
      <div className="mt-3 flex items-center gap-2 text-xs text-neutral-500">
        <span>{new Date(position.createdAt).toLocaleDateString()}</span>
        {position.signature && (
          <a
            href={getExplorerTransactionUrl(position.signature)}
            target="_blank"
            rel="noreferrer"
            className="font-semibold text-neutral-400 underline decoration-neutral-700 underline-offset-2 transition hover:text-white"
          >
            Explorer &#x2197;
          </a>
        )}
        {position.settledAt && (
          <span className="ml-auto">
            Settled {new Date(position.settledAt).toLocaleDateString()}
          </span>
        )}
      </div>
    </div>
  )
}
