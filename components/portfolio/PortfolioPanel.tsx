"use client"

import { useMarkets } from "@/components/providers/MarketProvider"
import { usePositions } from "@/components/providers/PositionProvider"
import { useSolanaWallet } from "@/components/providers/SolanaProvider"
import { getExplorerTransactionUrl } from "@/lib/solana/config"
import { formatSol } from "@/lib/utils/format"

const statusDisplay: Record<string, { label: string; className: string }> = {
  open: { label: "Open", className: "bg-blue-400/15 text-blue-300 border-blue-400/25" },
  claimable: { label: "Claimable", className: "bg-emerald-400/15 text-emerald-300 border-emerald-400/25" },
  claimed: { label: "Claimed", className: "bg-neutral-500/15 text-neutral-400 border-neutral-500/25" },
  refundable: { label: "Refundable", className: "bg-amber-400/15 text-amber-300 border-amber-400/25" },
  refunded: { label: "Refunded", className: "bg-neutral-500/15 text-neutral-400 border-neutral-500/25" },
  lost: { label: "Lost", className: "bg-red-400/15 text-red-300 border-red-400/25" },
}

export default function PortfolioPanel() {
  const { connected } = useSolanaWallet()
  const { positions, isFetching, fetchRemotePositions } = usePositions()
  const { markets, selectMarket } = useMarkets()

  const totalCommitted = positions.reduce((sum, p) => sum + p.amountSol, 0)
  const totalPotential = positions.reduce((sum, p) => sum + p.estimatedPayoutSol, 0)
  const settleablePositions = positions.filter(
    (p) => p.status === "claimable" || p.status === "refundable",
  )
  const settleableTotal = settleablePositions.reduce(
    (sum, p) => sum + (p.status === "claimable" ? p.estimatedPayoutSol : p.amountSol), 0,
  )
  const openPositions = positions.filter((p) => p.status === "open")
  const settledPositions = positions.filter((p) => p.status !== "open")

  return (
    <section aria-labelledby="portfolio-heading">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="eyebrow text-neutral-400">Your account</p>
          <h2 id="portfolio-heading" className="mt-1 text-xl font-semibold tracking-[-0.025em]">
            Devnet positions
          </h2>
        </div>
        <button
          type="button"
          onClick={fetchRemotePositions}
          disabled={isFetching || !connected}
          className="rounded-full border border-white/20 bg-white/[0.06] px-3 py-1.5 text-[9px] font-bold uppercase tracking-wider text-neutral-300 transition hover:border-white/40 hover:bg-white/15 disabled:opacity-50"
        >
          {isFetching ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      {!connected ? (
        <div className="mt-5 rounded-2xl border border-dashed border-white/20 bg-white/[0.03] px-5 py-8 text-center">
          <div className="mx-auto grid size-10 place-items-center rounded-full border border-white/20 text-lg" aria-hidden="true">
            &#9671;
          </div>
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
              <dt className="text-[9px] font-bold uppercase tracking-wider text-emerald-300">Committed</dt>
              <dd className="text-emerald-100 tabular mt-1 text-lg font-semibold">
                {formatSol(totalCommitted, 3)}
              </dd>
            </div>
            <div className="rounded-xl border border-white/15 bg-white/[0.04] p-3.5">
              <dt className="text-[9px] font-bold uppercase tracking-wider text-neutral-400">Potential payout</dt>
              <dd className="tabular mt-1 text-lg font-semibold">
                {formatSol(totalPotential, 3)}
              </dd>
            </div>
          </dl>

          {settleablePositions.length > 0 && (
            <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-emerald-400/20 bg-emerald-400/[0.04] p-3">
              <div>
                <p className="text-[9px] font-bold uppercase tracking-wider text-emerald-300">Ready to settle</p>
                <p className="tabular mt-0.5 text-sm font-semibold">
                  {formatSol(settleableTotal, 3)} across {settleablePositions.length} position{settleablePositions.length === 1 ? "" : "s"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  const target = settleablePositions[0]
                  const market = target && markets.find((m) => m.id === target.marketId)
                  if (market) selectMarket(market)
                }}
                className="shrink-0 rounded-full border border-emerald-400/40 bg-emerald-400/15 px-3 py-1.5 text-[11px] font-bold text-emerald-200 transition hover:bg-emerald-400/25"
              >
                Review &amp; claim
              </button>
            </div>
          )}

          {openPositions.length > 0 && (
            <>
              <h3 className="mb-3 mt-5 text-xs font-bold uppercase tracking-wider text-neutral-400">
                Open positions ({openPositions.length})
              </h3>
              <div className="divide-y divide-white/[0.06] rounded-xl border border-white/10 bg-white/[0.03]">
                {openPositions.map((position) => (
                  <PositionRow key={position.id} position={position} markets={markets} selectMarket={selectMarket} />
                ))}
              </div>
            </>
          )}

          {settledPositions.length > 0 && (
            <>
              <h3 className="mb-3 mt-5 text-xs font-bold uppercase tracking-wider text-neutral-500">
                Settled positions ({settledPositions.length})
              </h3>
              <div className="divide-y divide-white/[0.06] rounded-xl border border-white/10 bg-white/[0.03]">
                {settledPositions.slice(0, 10).map((position) => (
                  <PositionRow key={position.id} position={position} markets={markets} selectMarket={selectMarket} />
                ))}
              </div>
            </>
          )}
        </>
      )}

      <p className="mt-4 text-[9px] leading-4 text-neutral-600">
        Positions are indexed from your confirmed Solana transactions and stored
        in MongoDB. On-chain program accounts remain the source of truth.
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
  const statusInfo = statusDisplay[position.status] ?? {
    label: position.status,
    className: "bg-neutral-500/10 text-neutral-400",
  }

  return (
    <div className="px-3.5 py-3">
      <button
        type="button"
        disabled={!market}
        onClick={() => market && selectMarket(market)}
        className="line-clamp-2 text-left text-xs font-semibold leading-4 text-neutral-100 hover:underline disabled:cursor-default"
      >
        {position.marketQuestion}
      </button>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px]">
        <span
          className={
            position.side === "yes"
              ? "rounded border border-emerald-400/40 bg-emerald-400/15 px-1.5 py-0.5 font-bold text-emerald-300"
              : "rounded border border-red-400/40 bg-red-400/15 px-1.5 py-0.5 font-bold text-red-300"
          }
        >
          {position.side.toUpperCase()}
        </span>
        <span className="tabular text-neutral-300">
          {formatSol(position.amountSol, 3)} staked
        </span>
        {position.estimatedPayoutSol > 0 && (
          <span className="tabular text-neutral-500">
            / {formatSol(position.estimatedPayoutSol, 3)} payout
          </span>
        )}
        <span
          className={`ml-auto rounded-full border px-2 py-0.5 text-[9px] font-semibold ${statusInfo.className}`}
        >
          {statusInfo.label}
        </span>
      </div>
      <div className="mt-1.5 flex items-center gap-2 text-[9px] text-neutral-500">
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
          <span className="ml-auto">Settled {new Date(position.settledAt).toLocaleDateString()}</span>
        )}
      </div>
    </div>
  )
}
