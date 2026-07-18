"use client"

import { useMarkets } from "@/components/providers/MarketProvider"
import { usePositions } from "@/components/providers/PositionProvider"
import { useSolanaWallet } from "@/components/providers/SolanaProvider"
import { getExplorerTransactionUrl } from "@/lib/solana/config"
import { formatSol } from "@/lib/utils/format"

export default function PortfolioPanel() {
  const { connected } = useSolanaWallet()
  const { positions } = usePositions()
  const { markets, selectMarket } = useMarkets()
  const totalCommitted = positions.reduce(
    (sum, position) => sum + position.amountSol,
    0,
  )
  const totalPotential = positions.reduce(
    (sum, position) => sum + position.estimatedPayoutSol,
    0,
  )
  const settleablePositions = positions.filter(
    (position) =>
      position.status === "claimable" || position.status === "refundable",
  )
  const settleableTotal = settleablePositions.reduce(
    (sum, position) =>
      sum +
      (position.status === "claimable"
        ? position.estimatedPayoutSol
        : position.amountSol),
    0,
  )
  const awaitingCount = positions.filter(
    (position) => position.status === "open",
  ).length

  const reviewSettlement = () => {
    const target = settleablePositions[0]
    const market = target && markets.find((item) => item.id === target.marketId)
    if (market) selectMarket(market)
  }

  return (
    <section className="panel p-5 sm:p-6" aria-labelledby="portfolio-heading">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Your account</p>
          <h2
            id="portfolio-heading"
            className="mt-1 text-xl font-semibold tracking-[-0.025em]"
          >
            Devnet positions
          </h2>
        </div>
        <span className="rounded-full border border-neutral-300 px-2.5 py-1 text-[9px] font-bold uppercase tracking-wider text-neutral-500">
          Local index
        </span>
      </div>

      {!connected ? (
        <div className="mt-5 rounded-2xl border border-dashed border-neutral-300 bg-white/50 px-5 py-8 text-center">
          <div
            className="mx-auto grid size-10 place-items-center rounded-full border border-neutral-300 text-lg"
            aria-hidden="true"
          >
            ◇
          </div>
          <p className="mt-3 text-sm font-semibold">Connect a Devnet wallet</p>
          <p className="mx-auto mt-1 max-w-xs text-xs leading-5 text-neutral-500">
            Your confirmed purchases, claims, and refunds will appear here.
          </p>
        </div>
      ) : positions.length === 0 ? (
        <div className="mt-5 rounded-2xl border border-dashed border-neutral-300 bg-white/50 px-5 py-8 text-center">
          <p className="text-sm font-semibold">No indexed positions yet</p>
          <p className="mt-1 text-xs text-neutral-500">
            Choose a market on the globe and submit a Devnet purchase.
          </p>
        </div>
      ) : (
        <>
          <dl className="mt-5 grid grid-cols-2 gap-3">
            <div className="rounded-xl bg-ink p-3.5 text-white">
              <dt className="text-[9px] font-bold uppercase tracking-wider text-neutral-400">
                Committed
              </dt>
              <dd className="tabular mt-1 text-lg font-semibold">
                {formatSol(totalCommitted, 3)}
              </dd>
            </div>
            <div className="rounded-xl border border-neutral-300 bg-white p-3.5">
              <dt className="text-[9px] font-bold uppercase tracking-wider text-neutral-500">
                Potential payout
              </dt>
              <dd className="tabular mt-1 text-lg font-semibold">
                {formatSol(totalPotential, 3)}
              </dd>
            </div>
          </dl>
          {settleablePositions.length > 0 && (
            <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-ink bg-ink/5 p-3">
              <div>
                <p className="text-[9px] font-bold uppercase tracking-wider text-neutral-500">
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
                onClick={reviewSettlement}
                className="shrink-0 rounded-full bg-ink px-3 py-1.5 text-[11px] font-bold text-white transition hover:bg-neutral-800"
              >
                Review &amp; claim
              </button>
            </div>
          )}
          {awaitingCount > 0 && (
            <p className="mt-2 text-[10px] text-neutral-500">
              {awaitingCount} position{awaitingCount === 1 ? "" : "s"} awaiting
              resolution
            </p>
          )}
          <div className="mt-4 divide-y divide-neutral-100 rounded-xl border border-neutral-200 bg-white px-3.5">
            {positions.slice(0, 5).map((position) => {
              const market = markets.find(
                (item) => item.id === position.marketId,
              )
              return (
                <div key={position.id} className="py-3">
                  <button
                    type="button"
                    disabled={!market}
                    onClick={() => market && selectMarket(market)}
                    className="line-clamp-2 text-left text-xs font-semibold leading-4 hover:underline"
                  >
                    {position.marketQuestion}
                  </button>
                  <div className="mt-2 flex items-center gap-2 text-[10px]">
                    <span
                      className={
                        position.side === "yes"
                          ? "rounded bg-ink px-1.5 py-0.5 font-bold text-white"
                          : "rounded border border-neutral-300 px-1.5 py-0.5 font-bold"
                      }
                    >
                      {position.side.toUpperCase()}
                    </span>
                    <span className="text-neutral-500">
                      {formatSol(position.amountSol, 3)}
                    </span>
                    <span className="ml-auto rounded-full bg-neutral-100 px-2 py-0.5 font-semibold text-neutral-600">
                      {position.status}
                    </span>
                    {position.signature && (
                      <a
                        href={getExplorerTransactionUrl(position.signature)}
                        target="_blank"
                        rel="noreferrer"
                        aria-label="View transaction in Solana Explorer"
                        className="font-semibold underline decoration-neutral-300 underline-offset-2"
                      >
                        Explorer ↗
                      </a>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}
      <p className="mt-4 text-[9px] leading-4 text-neutral-500">
        This panel is a convenience index of signatures submitted in this
        browser. Solana program accounts remain the source of truth.
      </p>
    </section>
  )
}
