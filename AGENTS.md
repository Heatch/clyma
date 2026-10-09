# AGENTS.md — Clyma

## What this is

Clyma is a climate-risk prediction market on **Solana Devnet** (Hack the 6ix 2026,
winner "MLH: Best Use of Solana"). Pitch (from [Devpost](https://devpost.com/software/clyma)):
redirect prediction-market mechanics toward climate hedging — users take YES/NO
positions in Devnet SOL on real climate events (droughts, hurricanes, floods,
wildfires), generating a tradeable risk signal instead of pure speculation.

Core loop: explore Gemini-generated markets on an interactive D3 globe →
inspect evidence + resolution rules + probability chart → connect Phantom wallet →
buy YES/NO → claim/refund after permissioned resolution.

> **Prototype only. Devnet SOL has no monetary value.** Resolution is
> permissioned; there is no oracle/dispute process.

### Devpost vs. current code — read this first

The Devpost page is stale in two places:

- **No Freesolo / GRPO anymore.** Devpost describes a fine-tuned FreeSolo
  oddsmaker. That stack has been fully removed (`ml/`, Tavily, `FREESOLO_API_KEY`,
  `GRPO_ADAPTER_ID` are gone). **The model does both jobs now**: market generation
  (`lib/markets/generation.ts`) and probability forecasts (`POST /api/predict`,
  `app/api/predict/route.ts`, via the `lib/forecast/` seam).
- **"Fully automated resolution" is aspirational.** Resolution is a permissioned
  `resolve_market` instruction called by a resolver key, not an oracle.

## Quick start

```bash
npm install
cp .env.example .env   # fill in GEMINI_API_KEY (SQLITE_PATH defaults work)
npm run dev            # http://localhost:3000
```

Windows one-click launcher (dev hot-reload by default, `prod` arg for build+serve):

```cmd
start-app.bat        :: npm run dev, auto-installs + creates .env + opens browser
start-app.bat prod   :: npm run build && npm start
```

Seeding (needs funded Devnet wallet, ~10 SOL for 100 markets):

```bash
node scripts/preflight.mjs
node scripts/lifecycle.mjs seed --dry-run   # plan only, no writes
node scripts/lifecycle.mjs seed
```

Checks (also `npm run check` for all):

```bash
npm run format:check && npm run lint && npm run typecheck && npm test && npm run build
npm run test:anchor   # Anchor program tests (needs Rust + Solana CLI + local validator)
```

Requires Node `>=22.13.0` (`package.json:60-62`). Anchor program pinned to 1.1.2
(`Anchor.toml:2`).

## Repo map

```text
app/                          Next.js App Router: page + layout + API routes
app/api/markets|users|me|auth|predict|index-transaction
components/
  Dashboard.tsx               client composer (providers + Navbar + globe + drawer)
  globe/                      ClimateGlobe (D3 canvas), GlobeHero (filters/legend)
  markets/                    board, list items, details, chart, drawer, trending
  trading/                    PredictionForm (buy), RedeemPosition (claim/refund)
  providers/                  SolanaProvider, MarketProvider, PositionProvider, GlobeLinkProvider
  layout/                     Navbar (search, wallet, demo/prod toggle)
  wallet/ ui/ icons/          connect button, balance, skeletons, logo, hazard glyphs
hooks/                        useAIForecast, useMarketProgram (Anchor client)
lib/
  markets/                    types, calculations, generation, data (fixtures), openingPrice
  solana/                     config, pdas, accounts, instructions, encoding, errors, idl
  db/                         store.mjs (+ .d.mts), types, init, repositories/
  auth/ geo/ utils/ validation/
programs/climate_market/      Anchor Rust program (instructions, state, errors, events)
scripts/                      lifecycle.mjs (seed/close/resolve/roll),
                              preflight.mjs, lib/ (env, tape)
tests/                        vitest suite (see Testing)
```

No `ml/`, no `docs/`, no Freesolo/Tavily references. If you see any, delete them.

## Data model: one product, seeded markets

There is exactly one data path — no demo/prod modes, no mode toggle, no
`demo` cookie. `app/page.tsx` always runs `initDb()` + `queryMarkets()`.
`lib/markets/data.ts` exports deterministic seed fixtures (`fixtureMarkets`,
`SEED_WALLETS`, `fixtureUserPositions`, `fixtureUserActivity`) consumed by
tests and seeding. The `chainState` client field is `"unconfigured"` when no
program is configured, otherwise `"loading" | "synced" | "missing" | "error"`.

`MarketChainState` is the trade gate (`PredictionForm.tsx:158-199`), not any
mode flag. The Model forecast (`POST /api/predict`) never names its provider
in the UI or API responses (`forecaster: "model"`); provider names appear
only in code, env vars, and this doc.

## Frontend

- `app/page.tsx` is `force-dynamic`, queries SQLite, renders
  `<Dashboard initialMarkets>`.
- `MarketProvider.tsx:145-230` enriches the catalogue from chain PDAs on mount,
  on a 30s interval, and on `terraform:market-state-changed` events.
- `MarketDetails.tsx:46-58` renders `market.history`, overriding only the
  newest point with the Model forecast (`useAIForecast`).
- `PredictionForm.tsx` computes its quote with `calculatePooledTradeQuote()`
  (`lib/markets/calculations.ts:272`): before/after probabilities, avg
  execution price, payout, and `priceImpactLevel` (`none/low/moderate/high`)
  shown as a chip next to the pts impact (≥5 pts warning banner). The
  what-if size slider drives the same quote; `onPreviewChange` feeds the
  chart's dashed preview segment. Confirmed trades dispatch
  `clyma:trade-confirmed` (`TradeConfirmedDetail` in `lib/markets/types.ts`).
- Globe hover prefetches `/api/predict` fire-and-forget, deduped by region
  (`ClimateGlobe.tsx:791-810`).
- `MarketDetails` renders market history as-is plus a dashed Model reference
  line (`forecastProb`) and the preview segment (`previewProb`); the forecast
  never rewrites history points. A transient "Odds moved ±X pts" chip shows
  for 15s after a confirmed trade.
- `MarketProvider` keeps confirmed-trade points in an `optimisticRef` map and
  re-applies them on top of every chain refresh (pools stay chain-owned);
  `POST /api/index-transaction` is the durable path (snapshot + capped
  embedded history + counters, idempotent per signature).

## API routes (`app/api/`)

Envelope helpers in `app/api/_shared/responses.ts` (`apiSuccess`/`apiError`).
Validation via Zod in `lib/validation/marketSchemas.ts`.

```text
GET  /api/markets                  list/filter (queryMarkets)
GET  /api/markets/:id              getMarketById, 404 MARKET_NOT_FOUND
GET  /api/markets/:id/history      merged history: embedded tape + live
                                   market_prices snapshots, sorted, deduped
GET  /api/markets/region/:continent
POST /api/markets/create           zod body → fetchOpeningProbability → opening price
POST /api/predict                   Model forecast (see below)
GET  /api/users/:wallet/positions   public positions
GET  /api/users/:wallet/activity    public activity
POST /api/index-transaction          idempotent per signature: tx + position +
                                   price snapshot + capped history point +
                                   volume/participant counters
GET  /api/auth/challenge            issue 5-min nonce
POST /api/auth/verify               verify Solana sig (tweetnacl/bs58), sign JWT (jose, 7d)
GET  /api/me/positions | /api/me/activity   JWT-gated self views
```

### `POST /api/predict` (Gemini, `app/api/predict/route.ts`)

Body `{ question, resolution_rules?, news_context? }`. Requires `GEMINI_API_KEY`
(500 `server_misconfigured` otherwise). Calls `ai.interactions.create` with
`GEMINI_MODEL` (default `gemini-3.5-flash`), 15s timeout. Parses strict
`0.42`-format first, then any lone decimal, else `fallback: 0.5` (502
`inference_unavailable`). Returns
`{ probability, raw_output, forecaster: "model", format_valid, news_context_used }`.
No live web retrieval — callers pass their own `news_context`. Same credentials
as market generation. Callers: `useAIForecast` (chart point), `openingPrice.ts`
(new-market opening, via `POST /api/markets/create`), globe hover prefetch.
Provider naming never reaches the UI or API consumers.

## Solana program (`programs/climate_market/`)

- Crate `climate_market`, Anchor 1.1.2 (`Cargo.toml`, `Anchor.toml`).
- Instructions (`src/lib.rs:231-287`): `initialize_protocol`, `create_market`,
  `fund_market`, `buy_yes` / `buy_no`, `close_market`, `resolve_market`,
  `claim_winnings`, `refund_cancelled`.
- PDAs (`constants.rs`, `state.rs`): `protocol` (`authority, resolver,
  market_count`); `market` (`market_id, question_hash[32], timestamps, status,
  outcome, total_yes/no/pool/paid_amount`); `vault` (native SOL,
  SystemProgram transfers); per-(market, owner) `yes_position` + `no_position`;
  per-(market, claimant) `claim` (double-claim guard).
- Pooled binary math: `YES prob = YES pool / total pool` (on-chain `u128`
  checked math, round down; `lib/markets/calculations.ts:97` mirrors it).
  Payout pro-rata: `user winning position × total pool ÷ winning-side pool`.
- Lifecycle enforced on-chain: buy/fund only when `Open + now < close`;
  resolve needs `Closed + now >= resolution_ts` (`Yes/No` needs winning-side
  liquidity > 0 or must cancel); claim needs `Resolved`, refund needs
  `Cancelled`.
- **Program-ID rule:** `Anchor.toml:8-12` lists **devnet**
  `8THvFM9mEZEyzcxgnYU18BS4GNDJqK1Xixkjnuc5yted` vs **localnet**
  `EkcwkAzNUCGRcKCA5WJc7GCtUXooubkm3ktesBWQXPBt` — but preflight proved the
  program actually deployed on Devnet is **`Ekcwk…`** (executable, BPF-loader
  owned, protocol PDA decodes with `market_count=48`). The Anchor.toml devnet
  entry does NOT match the live deployment; do not switch to it without a
  fresh `anchor deploy`. The canonical address lives in exactly one place —
  `NEXT_PUBLIC_PROGRAM_ID` in `.env` (see `.env.example`). The app reads it
  via `lib/solana/config.ts`; all scripts read it via `scripts/lib/env.mjs`
  (`requireProgramId()`). Never hardcode a program id in app or script code.
  Run `node scripts/preflight.mjs` before any seeding: it checks RPC, program
  executability/owner, protocol PDA discriminator (validates the deployed
  program matches this repo's account layout), and wallet balance.

## Database (`lib/db/`, SQLite `./data/clyma.db`)

- `store.mjs` (+ `store.d.mts`): the single data layer, imported by both the
  TS repositories and `scripts/*.mjs`. Opens the DB (WAL, foreign keys,
  busy timeout), runs `user_version`-gated migrations, exposes table
  functions. Requires `node:sqlite` — flag-gated on Node 22.5.x, see
  `.npmrc` (`node-options`) for npm scripts, `start-app.bat`, and the
  `NODE_OPTIONS=--experimental-sqlite` prefix for bare `node scripts/*`.
  No MongoDB anywhere: the `mongodb` dependency is uninstalled.
- `types.ts`: doc types with string ids (positions use natural keys
  `market:side:txSignature`).
- Repositories: thin wrappers preserving signatures (`markets`, `positions`,
  `transactions`, `marketPrices`, `resolutions`, `users`). `init.ts: initDb()`
  just opens the store (migrations run inside).
- Schema: normalized where queried (`markets`, `market_history` capped at
  500 rows, `market_participants`, `market_prices`, `positions`,
  `transactions`, `resolutions`, `users`, `auth_challenges` with lazy expiry
  sweep); write-once blobs as JSON (`evidence`, `recentTrades`).
  `participants` is always `COUNT(*)` — no counter drift by construction.
- **Live trade writes:** `POST /api/index-transaction` writes the tx, position,
  price snapshot, capped history point, and counters — idempotent per
  signature, so retries and duplicate client POSTs are safe. The chart reads
  embedded history; `getMarketHistory` additionally merges `market_prices`.

## Model market generation (`lib/markets/generation.ts`)

`callGemini()` (90s timeout) → `extractJson()` → `mapMarket()` (category/
continent allow-lists, lat/lon ranges, real-URL check, prob clamp 0.05–0.95,
`climateMarketSchema.safeParse`, invalid dropped with warn) → disk cache
(`os.tmpdir()/clyma/gemini-markets.json`, 24h TTL, 5-min failure backoff).
`getInitialClimateMarkets()` falls back to `{ markets: [], source: "fallback" }`
— currently **dead code** (nothing imports it; `app/page.tsx` queries SQLite
directly).

## Scripts

- `scripts/preflight.mjs` — chain readiness check: RPC reachable, program
  account executable + BPF-loader-owned, protocol PDA discriminator matches
  this repo's layout, wallet balance reported. Run before any seeding.
- `scripts/lifecycle.mjs seed` — unified seeder: batched model generation
  (≤40 per call) → deterministic tapes (`scripts/lib/tape.mjs`) → asymmetric
  on-chain funding at exact tape totals → MongoDB indexing (market docs with
  embedded history/trades + `market_prices` creation snapshots). Flags:
  `--markets` (default 100), `--budget` pool SOL (default 6.5), `--base-id`
  (default 3001), `--fixture-file` (replay saved definitions offline),
  `--reset` (drop market collections, recreate indexes), `--skip-chain`,
  `--skip-db`, `--dry-run` (plan only), `--force` (skip funds check).
  Validated definitions are always saved to `os.tmpdir()/clyma/` for replay.
- `scripts/lifecycle.mjs close|resolve|roll` — expiry operations. `close`
  shuts past-close markets; `resolve` settles past-resolution markets by
  seeded draw against model odds (deterministic per market id, never
  hand-picked) with resolution records + position won/lost flags; `roll`
  runs both then tops up to `--markets` open markets (new IDs continue past
  the DB max, pool budget pro-rates). All support `--dry-run`. Builders and
  draw logic are unit-tested in `tests/lifecycle.test.ts` (module imports
  cleanly under vitest via a CLI-entry guard). See `docs/DEMO.md` runbook.
- `scripts/lib/tape.mjs` — deterministic trade tape: seeded PRNG, genesis
  liquidity at model odds, mean-reverting sides with shock runs, exact integer
  lamport pools. Tested in `tests/tape.test.ts` (vitest imports the .mjs via
  the `@` alias; types in `scripts/lib/tape.d.mts`).
- `scripts/lib/env.mjs` — shared script config: `.env` loader,
  `requireProgramId()`, `resolveRpcUrl()`. All scripts read the program id
  through here.

## Environment (`.env.example`)

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_SOLANA_NETWORK` | Must be `devnet` |
| `NEXT_PUBLIC_SOLANA_RPC_URL` | Optional override; defaults to public Devnet |
| `NEXT_PUBLIC_PROGRAM_ID` | Program address; unset → trading blocked ("program is not configured") |
| `SQLITE_PATH` | App database file (default `./data/clyma.db`) |
| `GEMINI_API_KEY` | AI Studio key; gates market generation + `/api/predict` |
| `GEMINI_MODEL` | Default `gemini-3.5-flash` |
| `GEMINI_MARKET_COUNT` | Default 24, max 40 |

Serving markets requires `GEMINI_API_KEY` (generation + forecasts). No DB
server: SQLite file via `node:sqlite` (flag-gated on Node 22.5.x — `.npmrc`
forwards `--experimental-sqlite` to all npm scripts).
Note: the SDK prefers a `GOOGLE_API_KEY` env var over `GEMINI_API_KEY` if both
are set — check there on auth confusion.

## Testing

- `npm test` → `vitest run`, jsdom, `tests/setup.ts` shims. Includes
  `tests/*.test.tsx` (api-routes, globe-drawer, navbar, prediction-form,
  hazard-icons, store, tape, lifecycle, market-history) + co-located
  `lib/solana/*.test.ts` (accounts, encoding, errors, instructions).
  Store tests run against real in-memory SQLite (`:memory:`).
- `tests/climate-market.ts` is Anchor integration — runs via
  `npm run test:anchor` only, not vitest.
- `fixtureUserPositions` / `fixtureUserActivity` in `lib/markets/data.ts` are
  **test fixtures only** (`tests/api-routes.test.ts`) — the My Positions UI
  does not consume them, so the portfolio can appear empty with a fresh DB.
- No known failures: `tests/navbar.test.tsx` (`clyma-mark` testid) and the
  `tests/globe-drawer.test.tsx` continent-filter case were fixed in Batch 1
  (missing `initialMarkets` prop + stale testid).

## Conventions

- TypeScript strict + `noUncheckedIndexedAccess` (`tsconfig.json`) — index
  carefully (`arr[i]!` or guards). `tsc --noEmit` must stay clean.
- Prettier: **no semicolons, double quotes**, `trailingComma: all`,
  `prettier-plugin-tailwindcss` (`npm run format`). `format:check` currently
  flags ~98 files repo-wide; keep touched files clean rather than reformatting
  the world.
- ESLint: `eslint-config-next` core-web-vitals + typescript;
  `react-hooks/set-state-in-effect` off (wallet/local-storage sync in effects
  is intentional).
- Tailwind 3.4 (`tailwind.config.ts`: `ink/paper/mist` palette, Inter/mono).
  `next.config.mjs`: `reactStrictMode`, wallet-adapter transpile, `fs/net/tls`
  fallbacks off for client bundle.
- Do not edit `next-env.d.ts` (generated; `git checkout --` it if dirty).

## Known issues / gotchas for agents

1. **Seed pools are small by design:** `lifecycle.mjs seed --budget` (default
   6.5 SOL over 100 markets) sizes pools so a 0.01–0.02 SOL trade visibly
   moves the odds. Scale-invariant math: impact depends on trade size
   relative to pool, not absolute SOL.
2. **Markets open at model odds:** funding is asymmetric
   (`est × T`, `(1−est) × T`) from the tape, never 50/50.
3. **History moves on live trades:** `POST /api/index-transaction` appends a
   capped history point to the market doc and a snapshot to `market_prices`;
   `getMarketHistory` merges both. In-session immediacy comes from the
   provider's optimistic points (see Frontend).
4. `GET /api/markets` returns SQLite docs, not chain state — headline
   odds only refresh after `MarketProvider`'s client-side PDA enrichment.
5. Scripts read RPC from `NEXT_PUBLIC_SOLANA_RPC_URL` (default public Devnet);
   `Anchor.toml` provider defaults to localnet — confirm cluster + program ID
   match before any on-chain work (`preflight.mjs` does this).
6. Never commit `.env` (gitignored) or API keys. A previous commit leaked
   Freesolo/MiniMax/Tavily keys — treat those as rotated/compromised, do not
   reintroduce them.
