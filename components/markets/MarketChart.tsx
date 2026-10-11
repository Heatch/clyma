"use client"

import { useId, useMemo, useState } from "react"
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import type { TooltipProps } from "recharts"

import type { MarketHistoryPoint } from "@/lib/markets/types"

type ChartTone = "light" | "dark"
type ChartRange = "1W" | "1M" | "ALL"

interface MarketChartProps {
  history: MarketHistoryPoint[]
  compact?: boolean
  tone?: ChartTone
  /** Live what-if preview (0–1): dashed segment from the current point. */
  previewProb?: number | null
  /** Most recent confirmed-trade move, shown briefly beside the chart delta. */
  recentTradeDeltaPts?: number | null
}

type ChartDatum = {
  timestamp: string
  time: number
  yes: number
  no: number
  totalVolume: number
  intervalVolume: number
}

const RANGE_OPTIONS: Array<{
  label: ChartRange
  durationMs: number | null
}> = [
  { label: "1W", durationMs: 7 * 86_400_000 },
  { label: "1M", durationMs: 30 * 86_400_000 },
  { label: "ALL", durationMs: null },
]

const SHORT_DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
})

const LONG_DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
})

const VOLUME_FORMATTER = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
})

function normalizeProbability(value: number) {
  return Math.round((value <= 1 ? value * 100 : value) * 10) / 10
}

function formatProbability(value: number) {
  return `${value.toFixed(Number.isInteger(value) ? 0 : 1)}%`
}

function buildChartData(history: MarketHistoryPoint[]): ChartDatum[] {
  const sortedHistory = [...history].sort(
    (first, second) =>
      Date.parse(first.timestamp) - Date.parse(second.timestamp),
  )

  return sortedHistory.map((point, index) => {
    const previousVolume = sortedHistory[index - 1]?.totalVolume

    return {
      timestamp: point.timestamp,
      time: Date.parse(point.timestamp),
      yes: normalizeProbability(point.yesProbability),
      no: normalizeProbability(point.noProbability),
      totalVolume: point.totalVolume,
      intervalVolume:
        previousVolume === undefined
          ? 0
          : Math.max(0, point.totalVolume - previousVolume),
    }
  })
}

function ProbabilityTooltip({
  active,
  payload,
  tone,
}: TooltipProps<number, string> & { tone: ChartTone }) {
  const datum = payload?.[0]?.payload as ChartDatum | undefined
  if (!active || !datum) return null

  return (
    <div
      className={`min-w-40 rounded-xl border px-3 py-2.5 text-[10px] shadow-2xl backdrop-blur-xl ${
        tone === "dark"
          ? "border-white/15 bg-black/90 text-white"
          : "border-neutral-200 bg-white/95 text-ink"
      }`}
    >
      <p className={tone === "dark" ? "text-white/50" : "text-neutral-500"}>
        {LONG_DATE_FORMATTER.format(new Date(datum.timestamp))}
      </p>
      <div className="mt-2 flex items-center justify-between gap-5">
        <span className="font-semibold">YES probability</span>
        <span className="tabular text-xs font-bold">
          {formatProbability(datum.yes)}
        </span>
      </div>
      <div className="mt-1 flex items-center justify-between gap-5">
        <span
          className={tone === "dark" ? "text-white/55" : "text-neutral-500"}
        >
          NO probability
        </span>
        <span className="tabular font-semibold">
          {formatProbability(datum.no)}
        </span>
      </div>
      <div
        className={`mt-2 flex items-center justify-between gap-5 border-t pt-2 ${
          tone === "dark" ? "border-white/10" : "border-neutral-200"
        }`}
      >
        <span
          className={tone === "dark" ? "text-white/55" : "text-neutral-500"}
        >
          Volume
        </span>
        <span className="tabular font-semibold">
          {VOLUME_FORMATTER.format(datum.totalVolume)} SOL
        </span>
      </div>
    </div>
  )
}

export function MiniMarketChart({
  history,
}: {
  history: MarketHistoryPoint[]
}) {
  if (history.length < 2)
    return (
      <div className="h-8 w-24 rounded bg-neutral-100" aria-hidden="true" />
    )
  const values = history.map((point) =>
    normalizeProbability(point.yesProbability),
  )
  const width = 96
  const height = 30
  const minimum = Math.min(...values)
  const maximum = Math.max(...values)
  const range = Math.max(1, maximum - minimum)
  const points = values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * width
      const y = height - 2 - ((value - minimum) / range) * (height - 4)
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(" ")

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="h-8 w-24 overflow-visible"
      role="img"
      aria-label={`YES probability trend from ${values[0]?.toFixed(0)} to ${values.at(-1)?.toFixed(0)} percent`}
    >
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}

export default function MarketChart({
  history,
  compact = false,
  tone = "light",
  previewProb = null,
  recentTradeDeltaPts = null,
}: MarketChartProps) {
  const gradientId = useId().replaceAll(":", "")
  const [requestedRange, setRequestedRange] = useState<ChartRange>("ALL")
  const allData = useMemo(() => buildChartData(history), [history])
  const latestTime = allData.at(-1)?.time ?? 0
  const rangedData = useMemo(
    () =>
      Object.fromEntries(
        RANGE_OPTIONS.map(({ label, durationMs }) => [
          label,
          durationMs === null
            ? allData
            : allData.filter((point) => point.time >= latestTime - durationMs),
        ]),
      ) as Record<ChartRange, ChartDatum[]>,
    [allData, latestTime],
  )
  const rangeAvailable = useMemo(
    () => ({
      "1W": rangedData["1W"].length >= 2,
      "1M": rangedData["1M"].length >= 2,
      ALL: rangedData.ALL.length > 0,
    }),
    [rangedData],
  )
  const activeRange = rangeAvailable[requestedRange] ? requestedRange : "ALL"
  const data = rangedData[activeRange]
  const firstDatum = data[0]
  const currentDatum = data.at(-1)
  const delta =
    firstDatum && currentDatum ? currentDatum.yes - firstDatum.yes : 0
  const hasMeaningfulDelta = Math.abs(delta) >= 0.05

  // Dashed what-if segment: current point → projected point. Kept out of the
  // ranged data so range buttons keep working on real history.
  const previewData = useMemo(() => {
    if (
      previewProb === null ||
      previewProb === undefined ||
      !Number.isFinite(previewProb) ||
      data.length === 0
    ) {
      return null
    }
    const lastDatum = data[data.length - 1]!
    const yes = normalizeProbability(Math.min(1, Math.max(0, previewProb)))
    return [
      { ...lastDatum },
      {
        ...lastDatum,
        timestamp: "preview",
        time: lastDatum.time + 1,
        yes,
        no: Math.round((100 - yes) * 10) / 10,
        intervalVolume: 0,
      },
    ]
  }, [previewProb, data])

  const colors =
    tone === "dark"
      ? {
          line: "#f5f5f0",
          secondary: "#8e8e87",
          grid: "rgba(255,255,255,0.11)",
          muted: "#a3a39d",
          surface: "#101010",
          volume: "rgba(255,255,255,0.28)",
        }
      : {
          line: "#111111",
          secondary: "#8b8b84",
          grid: "#deded8",
          muted: "#73736c",
          surface: "#ffffff",
          volume: "#c7c7c0",
        }

  if (allData.length === 0) {
    return (
      <div
        className={`grid h-36 w-full place-items-center rounded-xl border border-dashed text-xs ${
          tone === "dark"
            ? "border-white/15 text-white/45"
            : "border-neutral-200 text-neutral-500"
        }`}
        role="status"
      >
        No probability history yet
      </div>
    )
  }

  const chartLabel = `YES probability ${formatProbability(
    currentDatum?.yes ?? 0,
  )}, ${
    hasMeaningfulDelta
      ? `${delta > 0 ? "up" : "down"} ${Math.abs(delta).toFixed(1)} points`
      : "unchanged"
  } over ${activeRange === "ALL" ? "all history" : activeRange}`

  if (compact) {
    return (
      <div className="h-36 w-full" role="img" aria-label={chartLabel}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            accessibilityLayer
            data={data}
            margin={{ top: 10, right: 10, bottom: 0, left: -30 }}
          >
            <defs>
              <linearGradient
                id={`${gradientId}-compact`}
                x1="0"
                y1="0"
                x2="0"
                y2="1"
              >
                <stop offset="0%" stopColor={colors.line} stopOpacity={0.18} />
                <stop offset="100%" stopColor={colors.line} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke={colors.grid} vertical={false} />
            <ReferenceLine y={50} stroke={colors.grid} strokeDasharray="3 5" />
            <XAxis
              dataKey="timestamp"
              axisLine={false}
              tickLine={false}
              minTickGap={28}
              tickFormatter={(value: string) =>
                SHORT_DATE_FORMATTER.format(new Date(value))
              }
              tick={{ fill: colors.muted, fontSize: 9 }}
            />
            <YAxis
              domain={[0, 100]}
              ticks={[25, 50, 75]}
              axisLine={false}
              tickLine={false}
              tickFormatter={(value: number) => `${value}%`}
              tick={{ fill: colors.muted, fontSize: 9 }}
            />
            <Area
              type="monotone"
              dataKey="yes"
              name="YES"
              stroke={colors.line}
              strokeWidth={2}
              fill={`url(#${gradientId}-compact)`}
              isAnimationActive={false}
            />
            {currentDatum && (
              <ReferenceDot
                x={currentDatum.timestamp}
                y={currentDatum.yes}
                r={3.5}
                fill={colors.surface}
                stroke={colors.line}
                strokeWidth={2}
              />
            )}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    )
  }

  return (
    <section
      className={`w-full ${tone === "dark" ? "text-white" : "text-ink"}`}
      aria-label="Probability analysis"
    >
      <div className="flex items-end justify-between gap-4">
        <div>
          <h3 className="text-sm font-medium text-white/85">YES probability</h3>
          <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <p className="tabular text-3xl font-semibold tracking-[-0.04em]">
              {formatProbability(currentDatum?.yes ?? 0)}
            </p>
            <p className="tabular text-[11px] font-semibold text-white/55">
              {hasMeaningfulDelta
                ? `${delta > 0 ? "+" : ""}${delta.toFixed(1)} pts`
                : "0.0 pts"}
            </p>
            {recentTradeDeltaPts !== null && (
              <p className="text-[11px] text-sky-200" aria-live="polite">
                Odds moved {recentTradeDeltaPts >= 0 ? "+" : ""}
                {recentTradeDeltaPts.toFixed(1)} pts
              </p>
            )}
          </div>
        </div>

        <div
          className="flex items-center gap-3"
          aria-label="Probability history range"
        >
          {RANGE_OPTIONS.map(({ label }) => {
            const isAvailable = rangeAvailable[label]
            const isActive = activeRange === label
            return (
              <button
                key={label}
                type="button"
                disabled={!isAvailable}
                aria-pressed={isActive}
                title={
                  isAvailable
                    ? `Show ${label === "ALL" ? "all" : label} history`
                    : `Not enough points for ${label}`
                }
                onClick={() => setRequestedRange(label)}
                className={`px-1 py-1 text-[11px] font-semibold transition ${
                  isActive
                    ? "text-white underline decoration-white/60 underline-offset-4"
                    : "text-white/45 hover:text-white"
                }`}
              >
                {label}
              </button>
            )
          })}
        </div>
      </div>

      <p className="sr-only" aria-live="polite">
        {chartLabel}
      </p>

      <div className="mt-3 h-48 w-full sm:h-52">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            accessibilityLayer
            data={data}
            margin={{ top: 10, right: 12, bottom: 0, left: -18 }}
          >
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={colors.line} stopOpacity={0.2} />
                <stop offset="70%" stopColor={colors.line} stopOpacity={0.04} />
                <stop offset="100%" stopColor={colors.line} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke={colors.grid} vertical={false} />
            <ReferenceLine
              y={50}
              stroke={colors.muted}
              strokeOpacity={0.45}
              strokeDasharray="3 5"
            />
            <XAxis
              dataKey="timestamp"
              axisLine={false}
              tickLine={false}
              minTickGap={32}
              tickFormatter={(value: string) => {
                const time = new Date(value).getTime()
                if (Number.isNaN(time)) return ""
                return SHORT_DATE_FORMATTER.format(new Date(time))
              }}
              tick={{ fill: colors.muted, fontSize: 9 }}
            />
            <YAxis
              domain={[0, 100]}
              ticks={[0, 25, 50, 75, 100]}
              axisLine={false}
              tickLine={false}
              tickFormatter={(value: number) => `${value}%`}
              tick={{ fill: colors.muted, fontSize: 9 }}
            />
            <Tooltip<number, string>
              cursor={{
                stroke: colors.muted,
                strokeWidth: 1,
                strokeDasharray: "3 4",
              }}
              content={(props) => <ProbabilityTooltip {...props} tone={tone} />}
            />
            <Area
              type="monotone"
              dataKey="yes"
              name="YES"
              stroke={colors.line}
              strokeWidth={2.25}
              fill={`url(#${gradientId})`}
              isAnimationActive={false}
            />
            <Area
              type="monotone"
              dataKey="no"
              name="NO"
              stroke={colors.secondary}
              strokeDasharray="4 5"
              strokeWidth={1.25}
              fill="transparent"
              isAnimationActive={false}
            />
            {previewData && (
              <Line
                type="monotone"
                data={previewData}
                dataKey="yes"
                name="Preview"
                stroke={tone === "dark" ? "#7dd3fc" : "#0284c7"}
                strokeDasharray="5 4"
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
            )}
            {currentDatum && (
              <ReferenceDot
                x={currentDatum.timestamp}
                y={currentDatum.yes}
                r={4}
                fill={colors.surface}
                stroke={colors.line}
                strokeWidth={2.5}
              />
            )}
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="-mt-1 flex items-center justify-between px-1">
        <p
          className={`text-[8px] font-bold uppercase tracking-[0.14em] ${
            tone === "dark" ? "text-white/35" : "text-neutral-400"
          }`}
        >
          Interval volume
        </p>
        <div
          className={`flex items-center gap-3 text-[9px] font-semibold ${
            tone === "dark" ? "text-white/45" : "text-neutral-500"
          }`}
          aria-label="Chart legend"
        >
          <span>━ YES</span>
          <span>┄ NO</span>
          {previewData && (
            <span className={tone === "dark" ? "text-sky-200" : "text-sky-700"}>
              ┄ Preview
            </span>
          )}
        </div>
      </div>
      <div className="h-10 w-full" aria-hidden="true">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data}
            margin={{ top: 5, right: 12, bottom: 0, left: 12 }}
          >
            <XAxis dataKey="timestamp" hide />
            <YAxis hide domain={[0, "dataMax"]} />
            <Bar
              dataKey="intervalVolume"
              fill={colors.volume}
              maxBarSize={24}
              radius={[2, 2, 0, 0]}
              isAnimationActive={false}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  )
}
