# Demo runbook — Clyma

A reproducible path from empty machine to the 3-minute click path. Every
step prints what it will do before writing anything.

## 0. Prerequisites

- Node.js ≥ 22.13, npm dependencies installed (`npm install`)
- Phantom (or compatible) wallet with **~10 SOL on Devnet** for a full
  100-market seed (pools + rent + trading float + fees)
- `.env` filled in: `BACKBOARD_API_KEY` (`SQLITE_PATH` defaults to `./data/clyma.db`)
  (`LLM_MODEL` defaults to `gpt-5.6-luna`)
- Faucet if short: `solana airdrop 2` (repeat as needed), or
  https://faucet.solana.com

## 1. Chain readiness

```bash
node scripts/preflight.mjs
```

Expect: RPC reachable, program deployed at `NEXT_PUBLIC_PROGRAM_ID`
(executable, BPF-loader owned), protocol PDA check, wallet balance.
A missing protocol PDA is fine — seeding initializes it.

## 2. Seed 100 markets

```bash
# Plan only — verify counts, funding total, rent, and balance first.
node scripts/lifecycle.mjs seed --dry-run

# Real run (takes several minutes on Devnet; skips existing PDAs).
node scripts/lifecycle.mjs seed
```

What it does: batched model generation (≤40/call, validated, de-duplicated)
→ deterministic trade tape per market (pools sized to `--budget`, default
6.5 SOL total) → `create_market` + asymmetric `fund_market` at exact tape
totals → SQLite indexing (market rows with history/trades + `market_prices`
creation snapshots). Definitions are saved to
`os.tmpdir()/clyma/seed-definitions-<ts>.json` — keep the file; it is the
offline replay for demo day:

```bash
node scripts/lifecycle.mjs seed --fixture-file <saved-json> --reset
```

Variants: `--markets N`, `--budget SOL`, `--base-id ID`, `--skip-chain`,
`--skip-db`. Never combine `--reset` with a DB you care about (it drops
markets/positions/transactions/market_prices/resolutions and recreates
indexes; users/auth survive).

## 3. Renewal (expiry → resolution → top-up)

```bash
node scripts/lifecycle.mjs close     # shut expired markets (on-chain + DB)
node scripts/lifecycle.mjs resolve   # settle due markets by seeded draw
node scripts/lifecycle.mjs roll --dry-run   # preview: counts, IDs, budget
node scripts/lifecycle.mjs roll      # close + resolve + top up to 100 open
```

Outcomes are deterministic draws against each market's model odds
(`resolveDraw(marketId, odds)`), reproducible and never hand-picked.
Resolution is permissioned — this wallet is the resolver; there is no oracle
or dispute process. Every command supports `--dry-run` (lists, writes
nothing).

## 4. Run the app

```bash
start-app.bat        # dev server + browser, or:
npm run dev          # http://localhost:3000
```

## 5. The 3-minute click path

1. **Globe** — rotate, pick a hazard filter, note the market count.
2. **Market** — open a market with months of history; point at the curve.
3. **Model vs market** — show the "Model 62%" chip vs the market price and
   the dashed reference line: disagreement is the product thesis.
4. **What-if slider** — drag the size slider in the trade panel; read aloud
   "odds after: 63% → 76%" and point at the dashed preview segment on the
   chart.
5. **Real trade** — buy ~0.02 SOL YES/NO with Devnet SOL; watch the line bend
   and the "Odds moved +X pts" chip appear. Link the Solana Explorer
   transaction from the confirmation dialog.
6. **My Positions** — open the portfolio drawer; show the indexed position.
7. **Resolve (optional, needs an expired market)** — `lifecycle.mjs resolve`,
   then claim/refund in the app.

## 6. Resetting between runs

```bash
node scripts/lifecycle.mjs seed --fixture-file <saved-json> --reset
```

Replays identical markets (deterministic tapes), wipes trade history.
On-chain accounts persist (rent stays locked); markets keep their IDs.
For a fully fresh chain state, close/resolve first, or fund a new wallet
and seed with a new `--base-id`.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `Insufficient funds` | Airdrop more Devnet SOL; `--dry-run` shows the exact ask |
| `MARKET_NOT_FOUND` / empty board | SQLite file missing or empty — check `SQLITE_PATH` (default `./data/clyma.db`), re-run seed |
| Trading blocked, "not bound to a verified account" | `NEXT_PUBLIC_PROGRAM_ID` mismatch — run `preflight.mjs` |
| `/api/predict` 500 `server_misconfigured` | `BACKBOARD_API_KEY` missing; chart still renders market history |
| Generation 429s | Free-tier quota — the seeder backs off and retries; replay a saved definitions file instead |
| `Already closed` / `MarketNotClosed` on lifecycle ops | Re-run `close` before `resolve`; check `closeTime`/`resolutionTime` vs now |
