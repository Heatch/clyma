"use client"

import { useEffect, useMemo, useRef, useState } from "react"

import { usePositions } from "@/components/providers/PositionProvider"
import { useSolanaWallet } from "@/components/providers/SolanaProvider"
import useMarketProgram from "@/hooks/useMarketProgram"
import type { ClimateMarket, TradeSide } from "@/lib/markets/types"
import {
  TRADE_CONFIRMED_EVENT,
  type TradeConfirmedDetail,
} from "@/lib/markets/types"
import {
  calculatePooledTradeQuote,
  solToLamports,
  type PooledTradeQuote,
} from "@/lib/markets/calculations"
import { getExplorerTransactionUrl } from "@/lib/solana/config"
import { formatProbability, formatSol } from "@/lib/utils/format"

const QUICK_AMOUNTS = [0.05, 0.1, 0.25, 0.5]
const DEFAULT_NETWORK_FEE_SOL = 0.000005

interface PredictionFormProps {
  market: ClimateMarket
  tone?: "light" | "dark"
  onPreviewChange?: (preview: TradePreview | null) => void
}

export interface TradePreview {
  side: TradeSide
  yesProbability: number
}

function parseAmount(value: string) {
  if (!/^\d*(?:\.\d{0,9})?$/.test(value.trim())) return Number.NaN
  return Number(value)
}

export default function PredictionForm({
  market,
  tone = "light",
  onPreviewChange,
}: PredictionFormProps) {
  const { connected, publicKey } = useSolanaWallet()
  const { positions, recordPurchase } = usePositions()
  const { buy, balanceLamports, state, isPending, isConfigured, reset } =
    useMarketProgram(market)
  const [side, setSide] = useState<TradeSide>("yes")
  const [amount, setAmount] = useState("0.1")
  const [isReviewOpen, setIsReviewOpen] = useState(false)
  const [currentTime, setCurrentTime] = useState<number | null>(null)
  const reviewDialogRef = useRef<HTMLDivElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)
  const isPendingRef = useRef(isPending)
  const isDark = tone === "dark"

  useEffect(() => {
    isPendingRef.current = isPending
  }, [isPending])

  const marketPositions = useMemo(
    () => positions.filter((position) => position.marketId === market.id),
    [market.id, positions],
  )
  const indexedPositionSummary = useMemo(
    () =>
      marketPositions.reduce(
        (summary, position) => {
          summary[position.side] += position.amountSol
          return summary
        },
        { yes: 0, no: 0 },
      ),
    [marketPositions],
  )

  useEffect(() => {
    const updateCurrentTime = () => setCurrentTime(Date.now())
    updateCurrentTime()
    const timer = window.setInterval(updateCurrentTime, 30_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!isReviewOpen) return
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null
    const frame = window.requestAnimationFrame(() => {
      const firstFocusable =
        reviewDialogRef.current?.querySelector<HTMLElement>(
          'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        )
      firstFocusable?.focus({ preventScroll: true })
    })

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isPendingRef.current) {
        event.preventDefault()
        setIsReviewOpen(false)
        return
      }
      if (event.key !== "Tab" || !reviewDialogRef.current) return

      const focusable = [
        ...reviewDialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ]
      const first = focusable[0]
      const last = focusable.at(-1)
      if (!first || !last) return
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener("keydown", handleKeyDown)
    return () => {
      window.cancelAnimationFrame(frame)
      document.removeEventListener("keydown", handleKeyDown)
      previousFocusRef.current?.focus({ preventScroll: true })
    }
  }, [isReviewOpen])

  useEffect(() => {
    if (!isReviewOpen) return
    const frame = window.requestAnimationFrame(() => {
      const dialog = reviewDialogRef.current
      if (!dialog || dialog.contains(document.activeElement)) return
      dialog
        .querySelector<HTMLElement>(
          'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        )
        ?.focus({ preventScroll: true })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [isReviewOpen, state.status])

  const amountSol = parseAmount(amount)
  const balanceSol =
    balanceLamports === null ? null : Number(balanceLamports) / 1_000_000_000
  const quote: PooledTradeQuote | null = useMemo(() => {
    if (!Number.isFinite(amountSol) || amountSol <= 0) return null
    try {
      return calculatePooledTradeQuote({
        side,
        amountLamports: solToLamports(amountSol),
        yesPoolLamports: solToLamports(market.yesLiquidity),
        noPoolLamports: solToLamports(market.noLiquidity),
      })
    } catch {
      return null
    }
  }, [amountSol, market.noLiquidity, market.yesLiquidity, side])

  const priceImpactPts = quote ? quote.priceImpact * 100 : 0

  // Drive the parent chart's what-if projection segment.
  useEffect(() => {
    onPreviewChange?.(
      quote
        ? { side, yesProbability: quote.yesProbabilityAfter }
        : null,
    )
  }, [quote, side, onPreviewChange])

  const validationError = useMemo(() => {
    if (!connected || !publicKey)
      return "Connect a Solana wallet to purchase a position."
    if (!isConfigured)
      return "Deploy the program and set NEXT_PUBLIC_PROGRAM_ID before trading."
    if (market.chainState === "loading")
      return "Checking this market's Devnet account…"
    if (market.chainState === "missing")
      return "This market has not been created on Devnet."
    if (market.chainState === "error")
      return "This market's Devnet account could not be verified."
    if (isConfigured && market.chainState !== "synced")
      return "This market is not bound to a verified Devnet account."
    if (market.status !== "open")
      return `This market is ${market.status}; purchases are unavailable.`
    if (
      currentTime !== null &&
      new Date(market.closeTime).getTime() <= currentTime
    ) {
      return "This market has reached its trading deadline."
    }
    if (!Number.isFinite(amountSol))
      return "Enter a valid SOL amount with up to 9 decimal places."
    if (amountSol <= 0) return "Amount must be greater than zero."
    if (
      balanceSol !== null &&
      amountSol + DEFAULT_NETWORK_FEE_SOL > balanceSol
    ) {
      return "Amount plus the estimated network fee exceeds your wallet balance."
    }
    return null
  }, [
    amountSol,
    balanceSol,
    connected,
    currentTime,
    isConfigured,
    market.closeTime,
    market.chainState,
    market.status,
    publicKey,
  ])

  const submit = async () => {
    if (validationError || isPending) return
    try {
      const result = await buy(side, amount)
      recordPurchase({
        marketId: market.id,
        marketQuestion: market.question,
        region: market.region,
        side,
        amountSol,
        estimatedPayoutSol: quote?.potentialPayoutSol ?? 0,
        signature: result.signature,
      })

      if (publicKey) {
        void fetch("/api/index-transaction", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            wallet: publicKey.toBase58(),
            marketId: market.id,
            onchainMarketId: market.onchainMarketId,
            type: side === "yes" ? "purchase_yes" : "purchase_no",
            status: "confirmed",
            side,
            amountLamports: Math.round(amountSol * 1_000_000_000).toString(),
            transactionSignature: result.signature,
            yesPrice: quote?.yesProbabilityAfter,
            noPrice: quote?.noProbabilityAfter,
          }),
        }).catch(() => undefined)
      }

      const detail: TradeConfirmedDetail = {
        marketId: market.id,
        side,
        amountSol,
        yesProbabilityAfter: quote?.yesProbabilityAfter ?? market.yesPrice,
        noProbabilityAfter: quote?.noProbabilityAfter ?? market.noPrice,
      }
      window.dispatchEvent(
        new CustomEvent(TRADE_CONFIRMED_EVENT, { detail }),
      )
    } catch {
      // The hook maps and exposes a user-safe error in state.
    }
  }

  const loadingLabel: Record<string, string> = {
    preparing: "Preparing accounts…",
    simulating: "Simulating on Devnet…",
    awaiting_signature: "Approve in your wallet…",
    confirming: "Confirming transaction…",
  }

  return (
    <section
      className={`mt-5 rounded-2xl border p-4 sm:p-5 ${
        isDark
          ? "border-white/10 bg-white/[0.035] text-white"
          : "border-neutral-300 bg-white"
      }`}
      aria-labelledby="position-heading"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p
            className={
              isDark
                ? "font-mono text-[8px] uppercase tracking-[0.15em] text-white/30"
                : "eyebrow"
            }
          >
            Take a position
          </p>
          <h3 id="position-heading" className="mt-1 text-lg font-semibold">
            Trade with Devnet SOL
          </h3>
        </div>
        <span
          className={`rounded-full px-2.5 py-1 text-[9px] font-bold uppercase tracking-wider ${
            isDark
              ? "border border-white/10 bg-white/[0.05] text-white/35"
              : "bg-neutral-100 text-neutral-500"
          }`}
        >
          Pooled MVP
        </span>
      </div>

      <div
        className="mt-4 grid grid-cols-2 gap-2"
        role="group"
        aria-label="Select a market outcome"
      >
        {(["yes", "no"] as const).map((outcome) => {
          const selected = side === outcome
          const probability =
            outcome === "yes" ? market.yesPrice : market.noPrice
          return (
            <button
              key={outcome}
              type="button"
              aria-pressed={selected}
              disabled={isPending}
              onClick={() => {
                setSide(outcome)
                reset()
              }}
              className={`rounded-xl border p-3 text-left transition ${
                selected
                  ? outcome === "yes"
                    ? isDark
                      ? "border-emerald-300/50 bg-emerald-300/15 text-emerald-100 shadow-[inset_0_0_0_1px_rgba(110,231,183,0.1)]"
                      : "border-ink bg-ink text-white"
                    : isDark
                      ? "border-rose-300/50 bg-rose-300/15 text-rose-100 shadow-[inset_0_0_0_1px_rgba(253,164,175,0.1)]"
                      : "border-ink bg-neutral-100 text-ink"
                  : isDark
                    ? "border-white/10 bg-black/20 text-white/40 hover:border-white/25 hover:bg-white/[0.06] hover:text-white/70"
                    : "border-neutral-200 bg-white text-neutral-500 hover:border-neutral-400"
              }`}
            >
              <span className="block text-[9px] font-bold uppercase tracking-wider">
                Buy {outcome.toUpperCase()}
              </span>
              <span className="tabular mt-1 block text-xl font-semibold">
                {formatProbability(probability)}
              </span>
              <span className="mt-1 block text-[9px] opacity-70">
                {outcome === "yes" ? "Solid marker" : "Outlined marker"}
              </span>
            </button>
          )
        })}
      </div>

      <div className="mt-4">
        <div className="flex items-end justify-between gap-4">
          <label
            htmlFor={`amount-${market.id}`}
            className={`text-[10px] font-bold uppercase tracking-wider ${
              isDark ? "text-white/35" : "text-neutral-500"
            }`}
          >
            Amount
          </label>
          <span
            className={`tabular text-[10px] ${
              isDark ? "text-white/35" : "text-neutral-500"
            }`}
          >
            Balance:{" "}
            {balanceSol === null
              ? connected
                ? "Loading…"
                : "Not connected"
              : formatSol(balanceSol, 4)}
          </span>
        </div>
        <div className="relative mt-1.5">
          <input
            id={`amount-${market.id}`}
            data-testid="trade-amount"
            inputMode="decimal"
            autoComplete="off"
            value={amount}
            disabled={isPending}
            onChange={(event) => {
              setAmount(event.target.value)
              reset()
            }}
            aria-describedby={`amount-error-${market.id}`}
            className={`tabular h-12 w-full rounded-xl border px-3 pr-14 text-lg font-semibold outline-none transition ${
              isDark
                ? "border-white/15 bg-black/30 text-white focus:border-white/40 focus:ring-1 focus:ring-white/20"
                : "border-neutral-300 bg-white focus:border-ink focus:ring-1 focus:ring-ink"
            }`}
          />
          <span
            className={`pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold ${
              isDark ? "text-white/35" : "text-neutral-500"
            }`}
          >
            SOL
          </span>
        </div>
        <div className="mt-2 grid grid-cols-4 gap-1.5">
          {QUICK_AMOUNTS.map((quickAmount) => (
            <button
              type="button"
              key={quickAmount}
              disabled={isPending}
              onClick={() => {
                setAmount(String(quickAmount))
                reset()
              }}
              className={`rounded-lg border py-1.5 text-[10px] font-semibold transition ${
                isDark
                  ? "border-white/10 bg-white/[0.025] text-white/45 hover:border-white/25 hover:bg-white/[0.07] hover:text-white"
                  : "border-neutral-200 hover:border-ink hover:bg-neutral-50"
              }`}
            >
              {quickAmount}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-3">
        <div className="flex items-center justify-between gap-3">
          <label
            htmlFor={`size-preview-${market.id}`}
            className={`text-[10px] font-bold uppercase tracking-wider ${
              isDark ? "text-white/35" : "text-neutral-500"
            }`}
          >
            What-if size
          </label>
          <span
            className={`tabular text-[10px] font-semibold ${
              isDark ? "text-white/60" : "text-neutral-600"
            }`}
            aria-live="polite"
          >
            {quote
              ? `YES ${formatProbability(market.yesPrice)} → ${formatProbability(quote.yesProbabilityAfter)}`
              : "Enter an amount"}
          </span>
        </div>
        <input
          id={`size-preview-${market.id}`}
          type="range"
          min={0.01}
          max={2}
          step={0.01}
          value={Math.min(2, Math.max(0.01, Number.isFinite(amountSol) ? amountSol : 0.01))}
          disabled={isPending}
          onChange={(event) => {
            setAmount(event.target.value)
            reset()
          }}
          className="mt-1.5 w-full"
        />
      </div>

      <dl
        className={`mt-4 space-y-2 rounded-xl p-3 text-[10px] ${
          isDark ? "border border-white/10 bg-black/20" : "bg-neutral-100"
        }`}
      >
        <div className="flex justify-between gap-3">
          <dt className={isDark ? "text-white/35" : "text-neutral-500"}>
            Estimated position units
          </dt>
          <dd className="tabular font-semibold">
            {(quote?.amountSol ?? 0).toFixed(4)} {side.toUpperCase()}
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className={isDark ? "text-white/35" : "text-neutral-500"}>
            Average execution probability
          </dt>
          <dd className="tabular font-semibold">
            {formatProbability(quote?.averageExecutionPrice ?? 0)}
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className={isDark ? "text-white/35" : "text-neutral-500"}>
            Potential payout if correct
          </dt>
          <dd className="tabular font-semibold">
            {formatSol(quote?.potentialPayoutSol ?? 0, 4)}
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className={isDark ? "text-white/35" : "text-neutral-500"}>
            Odds after this trade
          </dt>
          <dd className="tabular font-semibold">
            {quote ? formatProbability(quote.yesProbabilityAfter) : "—"}
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className={isDark ? "text-white/35" : "text-neutral-500"}>
            Estimated price impact
          </dt>
          <dd className="tabular flex items-center gap-1.5 font-semibold">
            +{priceImpactPts.toFixed(2)} pts
            {quote && quote.priceImpactLevel !== "none" && (
              <span
                className={`rounded-full px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider ${
                  quote.priceImpactLevel === "low"
                    ? "bg-emerald-300/15 text-emerald-200"
                    : quote.priceImpactLevel === "moderate"
                      ? "bg-amber-300/15 text-amber-200"
                      : "bg-rose-300/15 text-rose-200"
                }`}
              >
                {quote.priceImpactLevel}
              </span>
            )}
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className={isDark ? "text-white/35" : "text-neutral-500"}>
            Estimated Solana fee
          </dt>
          <dd className="tabular font-semibold">
            ≈ {formatSol((state.feeLamports ?? 5000) / 1_000_000_000, 6)}
          </dd>
        </div>
      </dl>

      {marketPositions.length > 0 && (
        <div
          className={`mt-3 rounded-xl border px-3 py-2.5 text-[10px] ${
            isDark
              ? "border-white/[0.12] bg-white/[0.04] text-white/60"
              : "border-neutral-200 bg-neutral-50 text-neutral-600"
          }`}
          aria-live="polite"
        >
          <p className="font-bold uppercase tracking-[0.12em]">
            Your indexed position
          </p>
          <p className="tabular mt-1">
            {indexedPositionSummary.yes > 0
              ? `${formatSol(indexedPositionSummary.yes, 4)} YES`
              : ""}
            {indexedPositionSummary.yes > 0 && indexedPositionSummary.no > 0
              ? " · "
              : ""}
            {indexedPositionSummary.no > 0
              ? `${formatSol(indexedPositionSummary.no, 4)} NO`
              : ""}
          </p>
          <p
            className={`mt-1 ${isDark ? "text-white/35" : "text-neutral-500"}`}
          >
            Reconciled with program accounts when a Devnet deployment is
            configured.
          </p>
        </div>
      )}

      {priceImpactPts >= 5 && amountSol > 0 && (
        <p
          className={`mt-3 rounded-lg border px-3 py-2 text-[10px] font-semibold ${
            isDark
              ? "border-amber-300/30 bg-amber-300/10 text-amber-100"
              : "border-ink bg-neutral-100"
          }`}
          role="alert"
        >
          High price impact: this deposit materially changes the pool
          probability.
        </p>
      )}

      {validationError && (
        <p
          id={`amount-error-${market.id}`}
          className={`mt-3 text-[10px] font-medium ${
            isDark ? "text-white/45" : "text-neutral-600"
          }`}
          role="status"
        >
          {validationError}
        </p>
      )}

      <button
        type="button"
        data-testid="review-transaction"
        disabled={Boolean(validationError) || isPending}
        onClick={() => {
          reset()
          setIsReviewOpen(true)
        }}
        className={`mt-4 h-11 w-full rounded-full px-4 text-xs font-bold transition ${
          isDark
            ? "bg-white text-black hover:bg-emerald-100 disabled:bg-white/10 disabled:text-white/25"
            : "bg-ink text-white hover:bg-neutral-800 disabled:bg-neutral-300 disabled:text-neutral-500"
        }`}
      >
        Review {side.toUpperCase()} position
      </button>

      <p
        className={`mt-3 text-center text-[9px] leading-4 ${
          isDark ? "text-white/25" : "text-neutral-500"
        }`}
      >
        Your wallet will show the exact Devnet instruction. Never approve a
        transaction you do not understand.
      </p>

      {isReviewOpen && (
        <div
          className="fixed inset-0 z-[70] grid place-items-end bg-black/35 p-0 backdrop-blur-sm sm:place-items-center sm:p-4"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !isPending) {
              setIsReviewOpen(false)
            }
          }}
        >
          <div
            ref={reviewDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="review-heading"
            className={`w-full max-w-md rounded-t-[1.5rem] border p-5 shadow-panel sm:rounded-[1.5rem] ${
              isDark
                ? "border-white/10 bg-[#0d0f0e] text-white"
                : "border-neutral-300 bg-paper"
            }`}
          >
            {state.status === "success" && state.signature ? (
              <div aria-live="polite" className="text-center">
                <div
                  className={`mx-auto grid size-12 place-items-center rounded-full text-xl ${
                    isDark
                      ? "bg-emerald-500/20 text-emerald-300"
                      : "bg-ink text-white"
                  }`}
                >
                  ✓
                </div>
                <p
                  className={`mt-4 ${
                    isDark
                      ? "font-mono text-[8px] uppercase tracking-[0.15em] text-emerald-300/50"
                      : "eyebrow"
                  }`}
                >
                  Confirmed on Devnet
                </p>
                <h4 id="review-heading" className="mt-1 text-xl font-semibold">
                  Position recorded
                </h4>
                <p
                  className={`mt-2 text-xs leading-5 ${
                    isDark ? "text-white/40" : "text-neutral-500"
                  }`}
                >
                  Your browser portfolio was updated after Solana confirmed the
                  transaction.
                </p>
                <a
                  href={
                    state.explorerUrl ??
                    getExplorerTransactionUrl(state.signature)
                  }
                  target="_blank"
                  rel="noreferrer"
                  className={`mt-4 inline-block rounded-full border px-4 py-2 text-xs font-bold ${
                    isDark
                      ? "border-white/20 hover:bg-white hover:text-black"
                      : "border-ink hover:bg-ink hover:text-white"
                  }`}
                >
                  View transaction ↗
                </a>
                <button
                  type="button"
                  onClick={() => setIsReviewOpen(false)}
                  className={`mt-3 block w-full py-2 text-xs font-semibold ${
                    isDark
                      ? "text-white/30 hover:text-white"
                      : "text-neutral-500 hover:text-ink"
                  }`}
                >
                  Done
                </button>
              </div>
            ) : (
              <>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p
                      className={
                        isDark
                          ? "font-mono text-[8px] uppercase tracking-[0.15em] text-white/30"
                          : "eyebrow"
                      }
                    >
                      Transaction review
                    </p>
                    <h4
                      id="review-heading"
                      className="mt-1 text-xl font-semibold"
                    >
                      Buy {side.toUpperCase()}
                    </h4>
                  </div>
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() => setIsReviewOpen(false)}
                    className={`grid size-8 place-items-center rounded-full border ${
                      isDark
                        ? "border-white/15 hover:border-white/40"
                        : "border-neutral-300 hover:border-ink"
                    }`}
                    aria-label="Close transaction review"
                  >
                    ×
                  </button>
                </div>
                <p className="mt-3 text-sm font-semibold leading-5">
                  {market.question}
                </p>
                <dl
                  className={`mt-4 divide-y rounded-xl border px-3.5 text-xs ${
                    isDark
                      ? "divide-white/10 border-white/10 bg-black/20"
                      : "divide-neutral-200 border-neutral-200 bg-white"
                  }`}
                >
                  <div className="flex justify-between gap-4 py-3">
                    <dt
                      className={isDark ? "text-white/35" : "text-neutral-500"}
                    >
                      You deposit
                    </dt>
                    <dd className="tabular font-semibold">
                      {formatSol(amountSol, 4)}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-4 py-3">
                    <dt
                      className={isDark ? "text-white/35" : "text-neutral-500"}
                    >
                      Outcome
                    </dt>
                    <dd className="font-semibold">{side.toUpperCase()}</dd>
                  </div>
                  <div className="flex justify-between gap-4 py-3">
                    <dt
                      className={isDark ? "text-white/35" : "text-neutral-500"}
                    >
                      Estimated payout
                    </dt>
                    <dd className="tabular font-semibold">
                      {formatSol(quote?.potentialPayoutSol ?? 0, 4)}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-4 py-3">
                    <dt
                      className={isDark ? "text-white/35" : "text-neutral-500"}
                    >
                      Network
                    </dt>
                    <dd className="font-semibold">Solana Devnet</dd>
                  </div>
                </dl>

                {state.status === "error" && state.error && (
                  <div
                    className={`mt-3 rounded-xl border p-3 text-xs leading-5 ${
                      isDark
                        ? "border-rose-300/30 bg-rose-300/10"
                        : "border-neutral-400 bg-neutral-100"
                    }`}
                    role="alert"
                    aria-live="assertive"
                  >
                    <p className="font-bold">Transaction failed</p>
                    <p
                      className={`mt-1 ${
                        isDark ? "text-rose-200/80" : "text-neutral-600"
                      }`}
                    >
                      {state.error.message}
                    </p>
                    {(() => {
                      const logs =
                        state.simulationLogs.length > 0
                          ? state.simulationLogs
                          : (state.error?.logs ?? [])
                      return logs.length > 0 ? (
                        <details className="mt-2">
                          <summary
                            className={`cursor-pointer select-none ${
                              isDark ? "text-white/30" : "text-neutral-500"
                            }`}
                          >
                            Simulation logs
                          </summary>
                          <pre
                            className={`mt-1 max-h-28 overflow-auto whitespace-pre-wrap break-all text-[9px] leading-4 ${
                              isDark ? "text-white/25" : "text-neutral-500"
                            }`}
                          >
                            {logs.join("\n")}
                          </pre>
                        </details>
                      ) : null
                    })()}
                  </div>
                )}

                {isPending && (
                  <div
                    className={`mt-4 flex items-center gap-3 rounded-xl p-3 text-xs font-semibold ${
                      isDark ? "bg-white/5" : "bg-neutral-100"
                    }`}
                    role="status"
                    aria-live="polite"
                  >
                    <span
                      className={`soft-pulse size-2 rounded-full ${
                        isDark ? "bg-white/40" : "bg-ink"
                      }`}
                      aria-hidden="true"
                    />
                    {loadingLabel[state.status] ?? "Processing transaction…"}
                  </div>
                )}

                <button
                  type="button"
                  data-testid="confirm-transaction"
                  onClick={() => void submit()}
                  disabled={isPending || Boolean(validationError)}
                  className={`mt-4 h-11 w-full rounded-full px-4 text-xs font-bold transition ${
                    isDark
                      ? "bg-white text-black hover:bg-emerald-100 disabled:bg-white/10 disabled:text-white/25"
                      : "bg-ink text-white hover:bg-neutral-800 disabled:bg-neutral-300 disabled:text-neutral-500"
                  }`}
                >
                  {isPending
                    ? (loadingLabel[state.status] ?? "Processing…")
                    : state.status === "error"
                      ? "Try again"
                      : "Confirm in wallet"}
                </button>
                <p
                  className={`mt-3 text-center text-[9px] ${
                    isDark ? "text-white/25" : "text-neutral-500"
                  }`}
                >
                  Experimental prototype · Devnet SOL has no intended monetary
                  value
                </p>
              </>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
