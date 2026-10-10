// scripts/lib/tape.mjs — deterministic per-market trade tape generator.
//
// Single source of truth for seeded market activity. Given a market id, a
// target YES probability, and a pool depth, it produces a reproducible
// sequence of trades whose cumulative deposits EXACTLY equal the final pools
// (integer lamport math), plus the price history, volume, participants, and
// recent trades derived from that sequence.
//
// Consumers:
//   - scripts/lifecycle.mjs `seed` (funds on-chain pools to the tape totals,
//     writes the tape to SQLite)
//   - tests/tape.test.ts (invariant tests; vitest imports this .mjs directly)
//
// The tape is off-chain history ("trades that happened before you arrived"):
// trades carry no transaction signatures. Live Devnet trades append to the
// same SQLite tables afterwards.

import bs58 from "bs58"
import { createHash } from "node:crypto"

export const LAMPORTS_PER_SOL = 1_000_000_000
const TAPE_VERSION = "clyma-tape-v1"
const MIN_TRADE_LAMPORTS = 5_000

// --- deterministic PRNG (xmur3 hash + mulberry32) ----------------------------

function xmur3(str) {
  let h = 1779033703 ^ str.length
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353)
    h = (h << 13) | (h >>> 19)
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507)
    h = Math.imul(h ^ (h >>> 13), 3266489909)
    return (h ^= h >>> 16) >>> 0
  }
}

function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function prngFor(...parts) {
  const seedFn = xmur3([TAPE_VERSION, ...parts].join("|"))
  return mulberry32(seedFn())
}

// Box-Muller normal sample from a uniform PRNG.
function randNormal(rand) {
  const u = Math.max(rand(), 1e-12)
  const v = rand()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

// Deterministic wallet address for tape wallet `index` of a market. The
// address is the base58 encoding of a hash, so it is a well-formed public
// key string that no one holds the private key for — tape wallets never sign.
export function tapeWalletAddress(marketId, index) {
  return bs58.encode(
    createHash("sha256")
      .update(`${TAPE_VERSION}|${marketId}|wallet|${index}`)
      .digest(),
  )
}

function round4(value) {
  return Math.round(value * 10_000) / 10_000
}

/**
 * Build a deterministic trade tape.
 *
 * @param {object} args
 * @param {string} args.marketId      stable market id (also the PRNG seed)
 * @param {number} args.targetYes     target YES probability in (0, 1)
 * @param {number} args.depthSol      total pool depth in SOL (genesis + trades)
 * @param {number} [args.endTime]     unix ms of the last trade (default now)
 * @param {string} [args.seedTag]     extra seed domain separation
 */
export function buildTape({ marketId, targetYes, depthSol, endTime, seedTag }) {
  if (!marketId) throw new Error("buildTape: marketId is required")
  const target = Math.min(0.95, Math.max(0.05, Number(targetYes)))
  if (!Number.isFinite(target)) throw new Error("buildTape: bad targetYes")
  const depthLamports = Math.round(Number(depthSol) * LAMPORTS_PER_SOL)
  if (!Number.isFinite(depthLamports) || depthLamports <= 0) {
    throw new Error("buildTape: depthSol must be positive")
  }
  const end = Number.isFinite(endTime) ? endTime : Date.now()

  const rand = prngFor(seedTag ?? "tape", marketId)

  const tradeCount = 20 + Math.floor(rand() * 41) // 20–60
  const spanDays = 60 + Math.floor(rand() * 61) // 60–120
  const walletCount = 6 + Math.floor(rand() * 10) // 6–15
  const spanMs = spanDays * 86_400_000
  const start = end - spanMs

  // Genesis liquidity at model odds (funder deposit, not a trade).
  const genesisTotal = Math.max(1_000_000, Math.round(depthLamports * 0.15))
  const genesisYes = Math.round(genesisTotal * target)
  const genesisNo = genesisTotal - genesisYes
  const remaining = depthLamports - genesisTotal

  // Lognormal-ish weights scaled to exactly `remaining` lamports.
  const weights = Array.from({ length: tradeCount }, () =>
    Math.exp(0.9 * randNormal(rand)),
  )
  const weightSum = weights.reduce((a, b) => a + b, 0)
  const amounts = weights.map((w) =>
    Math.max(MIN_TRADE_LAMPORTS, Math.floor((w / weightSum) * remaining)),
  )
  // Fix rounding drift on the largest trade so the sum is exact.
  const drift = remaining - amounts.reduce((a, b) => a + b, 0)
  let biggest = 0
  for (let i = 1; i < amounts.length; i++) {
    if (amounts[i] > amounts[biggest]) biggest = i
  }
  amounts[biggest] += drift

  // 2–4 clustered "shock" runs: consecutive same-side trades that step the
  // price visibly. All other trades mean-revert toward the target (buying
  // pressure leans against the current deviation), so the path oscillates
  // around the target instead of random-walking away from it.
  const forced = new Array(tradeCount).fill(null)
  const shockWindows = 2 + Math.floor(rand() * 2)
  for (let s = 0; s < shockWindows; s++) {
    const at = Math.floor(rand() * Math.max(1, tradeCount - 2))
    const len = Math.min(tradeCount - at, 2 + Math.floor(rand() * 3))
    const side = rand() < 0.5 ? "yes" : "no"
    for (let i = at; i < at + len; i++) forced[i] = side
  }
  // Cap forced coverage at ~35% of trades so shocks step the price without
  // overwhelming the mean-reverting flow.
  const maxForced = Math.floor(tradeCount * 0.35)
  let forcedCount = forced.filter(Boolean).length
  for (let i = tradeCount - 1; i >= 0 && forcedCount > maxForced; i--) {
    if (forced[i]) {
      forced[i] = null
      forcedCount--
    }
  }

  // Wallets: first `walletCount` trades cover every wallet once.
  const wallets = Array.from({ length: tradeCount }, (_, i) =>
    i < walletCount ? i : Math.floor(rand() * walletCount),
  )

  // Timestamps ascending across (start, end].
  const step = spanMs / tradeCount
  const times = []
  let cursor = start
  for (let i = 0; i < tradeCount; i++) {
    const jitter = (rand() - 0.5) * step * 0.4
    cursor = Math.min(end, Math.max(cursor + 1, start + (i + 1) * step + jitter))
    times.push(Math.round(cursor))
  }
  times[tradeCount - 1] = end

  // Simulate pools from genesis; record the price path.
  let yes = genesisYes
  let no = genesisNo
  const history = [
    {
      timestamp: new Date(start).toISOString(),
      yesProbability: round4(yes / (yes + no)),
      noProbability: round4(no / (yes + no)),
      totalVolume: (yes + no) / LAMPORTS_PER_SOL,
      yesLiquidity: yes / LAMPORTS_PER_SOL,
      noLiquidity: no / LAMPORTS_PER_SOL,
    },
  ]
  const trades = []
  for (let i = 0; i < tradeCount; i++) {
    let side = forced[i]
    if (!side) {
      const price = yes / (yes + no)
      const pYes = Math.min(
        0.95,
        Math.max(0.05, target + 2 * (target - price)),
      )
      side = rand() < pYes ? "yes" : "no"
    }
    const amountLamports = amounts[i]
    if (side === "yes") yes += amountLamports
    else no += amountLamports
    const total = yes + no
    const price = yes / total
    const timestamp = new Date(times[i]).toISOString()
    trades.push({
      side,
      amountLamports,
      amountSol: amountLamports / LAMPORTS_PER_SOL,
      probability: round4(price),
      timestamp,
      walletIndex: wallets[i],
      wallet: tapeWalletAddress(marketId, wallets[i]),
    })
    history.push({
      timestamp,
      yesProbability: round4(price),
      noProbability: round4(1 - price),
      totalVolume: total / LAMPORTS_PER_SOL,
      yesLiquidity: yes / LAMPORTS_PER_SOL,
      noLiquidity: no / LAMPORTS_PER_SOL,
    })
  }

  const recentTrades = trades.slice(-8).map((t, i) => ({
    id: `${marketId}-trade-${trades.length - 8 + i + 1}`,
    marketId,
    side: t.side,
    amountSol: t.amountSol,
    amountLamports: String(t.amountLamports),
    probability: t.probability,
    estimatedPayoutSol: Math.round((t.amountSol / t.probability) * 10_000) / 10_000,
    wallet: t.wallet,
    timestamp: t.timestamp,
  }))

  return {
    marketId,
    targetYes: target,
    depthSol,
    startTime: new Date(start).toISOString(),
    endTime: new Date(end).toISOString(),
    tradeCount,
    walletCount,
    shockWindows,
    genesis: { yesLamports: genesisYes, noLamports: genesisNo },
    trades,
    pools: { yesLamports: yes, noLamports: no, totalLamports: yes + no },
    history,
    totalVolumeLamports: yes + no,
    totalVolumeSol: (yes + no) / LAMPORTS_PER_SOL,
    participants: new Set(trades.map((t) => t.wallet)).size,
    recentTrades,
  }
}
