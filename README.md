# TerraForm

TerraForm is an experimental climate-risk prediction market interface for
Solana Devnet. It combines an interactive geographic atlas with a pooled binary
market program: users explore fictional climate scenarios on a rotating globe,
inspect the evidence and resolution rules, connect a Phantom-compatible wallet,
and submit YES or NO positions in Devnet SOL.

> **Prototype only.** TerraForm is not a production financial service. The
> market catalogue, probability history, evidence summaries, activity, and
> liquidity shown in the interface are explicitly labelled fictional sample
> data. Devnet SOL has no intended monetary value.

## Current status

The repository contains the complete browser transaction path and an Anchor
program for native-SOL purchases, resolution, proportional claims, and cancelled
market refunds. Trading remains disabled until an operator deploys the program,
initializes its protocol account, creates matching on-chain markets, and sets
`NEXT_PUBLIC_PROGRAM_ID`.

The program address declared in source is not proof of a deployment. Always
verify the configured address on Devnet before enabling trading:

```bash
solana program show "$NEXT_PUBLIC_PROGRAM_ID" --url devnet
```

## Product workflow

1. Rotate, zoom, or keyboard-navigate the transparent globe.
2. Select a market node or use the text-based region selector.
3. Filter the regional drawer and open a market.
4. Review its probability history, pools, evidence, resolver, close time, and
   resolution rules.
5. Connect a supported browser wallet on Solana Devnet.
6. Choose YES or NO, enter a SOL amount, and review the estimated payout, fee,
   and price impact.
7. Simulate the transaction, approve it in the wallet, and wait for confirmed
   commitment.
8. Open the Solana Explorer link and use the same wallet to claim or refund an
   eligible position after settlement.

The globe remains visible while the responsive market drawer is open. On small
screens the drawer becomes a bottom sheet, and the region selector provides a
non-canvas navigation fallback.

## Architecture

| Area            | Implementation                                                          |
| --------------- | ----------------------------------------------------------------------- |
| Web application | Next.js App Router, React, TypeScript, Tailwind CSS                     |
| Globe           | D3 orthographic canvas projection with local Natural Earth data         |
| Charts          | Recharts                                                                |
| Wallet          | Phantom Wallet Adapter with a client-only provider                      |
| Solana client   | `@solana/web3.js`, Anchor instruction encoding, deterministic PDAs      |
| Program         | Anchor 0.30.1 Rust program under `programs/climate_market`              |
| Validation      | Zod schemas for market metadata, query parameters, and indexing input   |
| Data            | Typed in-memory repository seeded with clearly labelled demo records    |
| Tests           | Vitest/Testing Library plus an Anchor local-validator integration suite |

Important paths:

```text
app/api/                         Typed demo API routes
components/globe/                Interactive globe and globe workspace
components/markets/              Regional list, details, chart, and controls
components/trading/              Purchase review and settlement controls
components/providers/            Market, wallet, position, and globe state
hooks/useMarketProgram.ts         Simulation, signing, confirmation, and errors
lib/markets/                      Types, calculations, repository, and demo data
lib/solana/                       Configuration, encoding, PDAs, IDL, instructions
programs/climate_market/          Anchor program
tests/                            Frontend, API, calculation, and Anchor tests
```

## Pooled binary market model

YES and NO deposits enter one program-owned market vault. Before resolution,
the displayed implied probabilities are derived from the pool totals:

```text
YES probability = total YES pool / total market pool
NO probability  = total NO pool  / total market pool
```

After an authorized resolver records YES or NO, each winning wallet receives a
proportional share of the final pool:

```text
user payout =
  user winning position × total market pool ÷ total winning-side pool
```

The program performs the multiplication in `u128`, uses checked arithmetic,
then rounds integer division down to whole lamports. Sub-lamport division dust
remains in the vault. If a market is cancelled, each wallet may reclaim its
original YES and NO deposits instead.

This is a pooled-market MVP, not a central limit order book. The frontend quote
shows how a proposed deposit changes the pool ratio; final settlement is always
calculated by the program from on-chain balances.

## Solana accounts and instructions

Program Derived Addresses are used for:

- protocol configuration;
- market state;
- the native-SOL market vault;
- each wallet's YES position;
- each wallet's NO position; and
- each wallet's claim record.

The program exposes these instructions:

- `initialize_protocol`
- `create_market`
- `fund_market`
- `buy_yes`
- `buy_no`
- `close_market`
- `resolve_market`
- `claim_winnings`
- `refund_cancelled`

The market authority creates and initially funds markets. Any signer may close
an open market after its deadline, but only the resolver stored in the protocol
and market accounts may record YES, NO, or CANCELLED. Resolution is rejected
before the configured resolution timestamp.

## Local web setup

Requirements:

- Node.js 22.13 or newer;
- npm; and
- a Phantom-compatible browser extension for wallet interaction.

Install and configure the app:

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Environment variables:

```env
NEXT_PUBLIC_SOLANA_NETWORK=devnet
NEXT_PUBLIC_SOLANA_RPC_URL=
NEXT_PUBLIC_PROGRAM_ID=
DATABASE_URL=
```

- `NEXT_PUBLIC_SOLANA_NETWORK` must remain `devnet` for this prototype.
- An empty RPC URL uses Solana's public Devnet endpoint.
- `NEXT_PUBLIC_PROGRAM_ID` must be the verified deployed program address. An
  empty or invalid value keeps purchase and settlement controls disabled.
- `DATABASE_URL` is reserved for a future persistent repository and is not read
  by the current in-memory implementation.

Never put a private key, seed phrase, or wallet JSON in an environment variable
or committed file. Only public addresses and RPC URLs belong in browser-exposed
variables.

## Web checks

```bash
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
```

Run the complete web gate with:

```bash
npm run check
```

The Vitest suite covers market arithmetic and validation, seeded data,
repository isolation, API responses, globe-to-drawer navigation, transaction
form validation/loading/success/failure behavior, Solana amount encoding,
client instruction layout, and program-error mapping.

## Anchor toolchain and local-validator tests

The program and TypeScript Anchor client are pinned to Anchor `0.30.1`. Keep the
Anchor CLI, `anchor-lang`, and `@coral-xyz/anchor` versions aligned. Anchor's
[installation guide](https://www.anchor-lang.com/docs/installation) documents
Rust, Solana CLI, and AVM setup; the 0.30 line supports Solana versions above
1.16 and recommends Solana 1.18.8.

One compatible setup is:

```bash
cargo install --git https://github.com/solana-foundation/anchor --tag v0.30.1 avm --locked
avm install 0.30.1
avm use 0.30.1
solana-install init 1.18.8
```

Then run:

```bash
anchor --version
solana --version
anchor build
npm run test:anchor
```

`npm run test:anchor` starts a local validator through Anchor, deploys the
program locally, and runs `tests/climate-market.ts`. The suite covers protocol
initialization, market creation and funding, zero-value rejection, YES and NO
purchases, deadline enforcement, unauthorized resolution, YES/NO/CANCELLED
resolution, winning claims, losing claims, double-claim protection, refunds,
and incorrect PDA rejection.

## Devnet deployment

Deployment changes public chain state and requires an operator-controlled
Devnet keypair. Do not commit that keypair.

1. Configure a dedicated Devnet wallet and fund it with faucet SOL:

   ```bash
   solana config set --url devnet
   solana-keygen new --outfile /secure/path/terraform-devnet-authority.json
   solana config set --keypair /secure/path/terraform-devnet-authority.json
   solana airdrop 2
   solana balance
   ```

2. Confirm the generated program keypair matches `declare_id!` and
   `Anchor.toml`:

   ```bash
   anchor build
   anchor keys list
   ```

   `target/deploy/climate_market-keypair.json` is intentionally ignored. If a
   newly generated program keypair changes the address, run `anchor keys sync`,
   review the source changes, and update the frontend environment value.

3. Deploy to Devnet and verify the executable account:

   ```bash
   anchor deploy --provider.cluster devnet
   solana program show <PROGRAM_ID> --url devnet
   ```

4. Using an operator client, initialize the protocol with an authorized
   resolver, then create and fund on-chain markets whose numeric IDs match the
   frontend metadata. A declared or deployed program alone is not tradable;
   the protocol, market, vault, and initial position accounts must exist.

5. Put the verified public address in `.env.local`, restart Next.js, connect a
   wallet on Devnet, and first submit a small test position.

## Resolution and claims

The program does not pretend to observe weather. Off-chain metadata records the
source URL and exact resolution rule, while the configured resolver submits the
on-chain decision only after trading closes. The program records the resolver,
outcome, and settlement event; it does not trust climate API responses directly.

For production, resolver operations should be run from a hardened service or
multisig with independently auditable evidence. A future oracle adapter can be
added without changing the position and vault PDA model.

## API routes

All current endpoints return consistent `{ data, meta }` or `{ error, meta }`
objects, set `Cache-Control: no-store`, and identify their content as sample
Devnet data.

```text
GET  /api/markets
GET  /api/markets/:id
GET  /api/markets/:id/history
GET  /api/markets/region/:continent
GET  /api/users/:wallet/positions
GET  /api/users/:wallet/activity
POST /api/index-transaction
```

`POST /api/index-transaction` validates metadata and stores it only in process
memory. It is a convenience index, not proof of a transaction and not the
source of truth for balances, status, outcomes, or claims.

## Security properties

- No private keys or seed phrases are requested or stored by the app.
- Wallet signatures remain inside the browser wallet adapter.
- Program accounts use deterministic seeds and Anchor constraints.
- Authorities, resolver signers, market ownership, position ownership, vaults,
  and claim records are validated on-chain.
- Deposits and pool totals use checked arithmetic.
- Trading is rejected after close and resolution is rejected before its time.
- Claim records prevent repeated claims and refunds.
- The frontend blocks invalid amounts and duplicate submissions, estimates the
  fee, simulates before signing, confirms against the transaction blockhash,
  and maps program errors to user-safe messages.
- Program state—not browser storage or API metadata—is authoritative.

## Known MVP limitations

- No program deployment or upgrade-authority keypair is committed, by design.
  A real Devnet workflow requires the operator steps above.
- The market repository and transaction index are in memory; restarts discard
  newly indexed server activity.
- Browser portfolio entries are a convenience cache and are not a full account
  indexer.
- Only native Devnet SOL and the Phantom adapter are currently wired into the
  UI.
- Resolution is permissioned and has no oracle or dispute process.
- Market metadata and charts are fictional seeded records, not live climate
  observations.
- The pooled model has no order book, limit orders, fees, or liquidity-provider
  shares. Integer settlement can leave vault dust.
- Anchor integration tests require Rust, Solana CLI, Anchor CLI, and a local
  validator; the web-only check cannot substitute for them.

## Planned evolution

- PostgreSQL or Supabase metadata repository and an idempotent event indexer;
- durable program-event indexing and historical on-chain pool snapshots;
- stablecoin settlement behind an asset abstraction;
- multisig/oracle resolution with a dispute window;
- persistent market administration and Devnet seeding tools;
- additional wallet adapters; and
- production observability, threat modelling, and independent program review.

TerraForm is designed as a climate-risk research prototype. It should not be
used with mainnet funds without a complete security audit and production
operations plan.
