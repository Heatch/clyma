import * as anchor from "@coral-xyz/anchor"
import { BN, type Program } from "@coral-xyz/anchor"
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { beforeAll, describe, it } from "vitest"
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js"

const PROTOCOL_SEED = Buffer.from("protocol")
const MARKET_SEED = Buffer.from("market")
const VAULT_SEED = Buffer.from("vault")
const YES_POSITION_SEED = Buffer.from("yes_position")
const NO_POSITION_SEED = Buffer.from("no_position")
const CLAIM_SEED = Buffer.from("claim")
const BPF_LOADER_UPGRADEABLE_PROGRAM_ID = new PublicKey(
  "BPFLoaderUpgradeab1e11111111111111111111111",
)

const MARKET_STATUS_OFFSET = 160
const MARKET_OUTCOME_OFFSET = 161
const MARKET_TOTAL_YES_OFFSET = 162
const MARKET_TOTAL_NO_OFFSET = 170
const MARKET_TOTAL_POOL_OFFSET = 178
const MARKET_TOTAL_PAID_OFFSET = 186
const POSITION_AMOUNT_OFFSET = 73
const CLAIM_KIND_OFFSET = 73
const CLAIM_AMOUNT_OFFSET = 74

type Side = "yes" | "no"

interface UserAddresses {
  yesPosition: PublicKey
  noPosition: PublicKey
  claimRecord: PublicKey
}

interface MarketAddresses {
  market: PublicKey
  vault: PublicKey
}

interface DecodedMarket {
  status: number
  outcome: number
  totalYes: bigint
  totalNo: bigint
  totalPool: bigint
  totalPaid: bigint
}

function u64Seed(value: BN): Buffer {
  return value.toArrayLike(Buffer, "le", 8)
}

function deriveProtocol(programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([PROTOCOL_SEED], programId)[0]
}

function deriveMarket(programId: PublicKey, marketId: BN): MarketAddresses {
  const market = PublicKey.findProgramAddressSync(
    [MARKET_SEED, u64Seed(marketId)],
    programId,
  )[0]
  const vault = PublicKey.findProgramAddressSync(
    [VAULT_SEED, market.toBuffer()],
    programId,
  )[0]
  return { market, vault }
}

function deriveUser(
  programId: PublicKey,
  market: PublicKey,
  owner: PublicKey,
): UserAddresses {
  const yesPosition = PublicKey.findProgramAddressSync(
    [YES_POSITION_SEED, market.toBuffer(), owner.toBuffer()],
    programId,
  )[0]
  const noPosition = PublicKey.findProgramAddressSync(
    [NO_POSITION_SEED, market.toBuffer(), owner.toBuffer()],
    programId,
  )[0]
  const claimRecord = PublicKey.findProgramAddressSync(
    [CLAIM_SEED, market.toBuffer(), owner.toBuffer()],
    programId,
  )[0]
  return { yesPosition, noPosition, claimRecord }
}

function hashQuestion(question: string): number[] {
  return [...createHash("sha256").update(question).digest()]
}

function readU64(data: Buffer, offset: number): bigint {
  return data.readBigUInt64LE(offset)
}

function decodeMarket(data: Buffer): DecodedMarket {
  return {
    status: data[MARKET_STATUS_OFFSET] ?? -1,
    outcome: data[MARKET_OUTCOME_OFFSET] ?? -1,
    totalYes: readU64(data, MARKET_TOTAL_YES_OFFSET),
    totalNo: readU64(data, MARKET_TOTAL_NO_OFFSET),
    totalPool: readU64(data, MARKET_TOTAL_POOL_OFFSET),
    totalPaid: readU64(data, MARKET_TOTAL_PAID_OFFSET),
  }
}

function readPositionAmount(data: Buffer): bigint {
  return readU64(data, POSITION_AMOUNT_OFFSET)
}

async function expectProgramError(
  operation: Promise<unknown>,
  expectedNumber: number,
): Promise<void> {
  try {
    await operation
    assert.fail(`Expected program error ${expectedNumber}`)
  } catch (error: unknown) {
    const candidate = error as {
      error?: { errorCode?: { number?: number } }
      logs?: string[]
      message?: string
    }
    const actual = candidate.error?.errorCode?.number
    const text = [candidate.message, ...(candidate.logs ?? [])]
      .filter((entry): entry is string => typeof entry === "string")
      .join("\n")

    assert.equal(
      actual === expectedNumber ||
        text.includes(`Error Number: ${expectedNumber}`) ||
        text
          .toLowerCase()
          .includes(`custom program error: 0x${expectedNumber.toString(16)}`),
      true,
      `Expected error ${expectedNumber}, received ${actual ?? text}`,
    )
  }
}

describe("climate_market", () => {
  const provider = anchor.AnchorProvider.env()
  anchor.setProvider(provider)

  const program = anchor.workspace.ClimateMarket as Program
  const authority = provider.wallet.publicKey
  const resolver = Keypair.generate()
  const outsider = Keypair.generate()
  const yesBuyer = Keypair.generate()
  const noBuyer = Keypair.generate()
  const refundBuyer = Keypair.generate()
  const protocol = deriveProtocol(program.programId)

  const idBase = new BN(Date.now())
  const yesMarketId = idBase
  const noMarketId = idBase.addn(1)
  const cancelledMarketId = idBase.addn(2)
  const yesMarket = deriveMarket(program.programId, yesMarketId)
  const noMarket = deriveMarket(program.programId, noMarketId)
  const cancelledMarket = deriveMarket(program.programId, cancelledMarketId)

  let closeTimestamp = 0

  async function airdrop(recipient: PublicKey, sol = 8): Promise<void> {
    const signature = await provider.connection.requestAirdrop(
      recipient,
      sol * LAMPORTS_PER_SOL,
    )
    const latest = await provider.connection.getLatestBlockhash()
    await provider.connection.confirmTransaction(
      { signature, ...latest },
      "confirmed",
    )
  }

  async function accountData(address: PublicKey): Promise<Buffer> {
    const account = await provider.connection.getAccountInfo(
      address,
      "confirmed",
    )
    assert.notEqual(account, null, `Missing account ${address.toBase58()}`)
    return Buffer.from(account!.data)
  }

  async function createMarket(
    marketId: BN,
    addresses: MarketAddresses,
    label: string,
  ): Promise<void> {
    await program.methods.createMarket!(
      marketId,
      hashQuestion(label),
      new BN(closeTimestamp),
      new BN(closeTimestamp),
    )
      .accountsStrict({
        protocol,
        market: addresses.market,
        vault: addresses.vault,
        authority,
        systemProgram: SystemProgram.programId,
      })
      .rpc()
  }

  async function fundMarket(
    market: MarketAddresses,
    yesLamports: number,
    noLamports: number,
  ): Promise<void> {
    const positions = deriveUser(program.programId, market.market, authority)
    await program.methods.fundMarket!(new BN(yesLamports), new BN(noLamports))
      .accountsStrict({
        protocol,
        market: market.market,
        vault: market.vault,
        yesPosition: positions.yesPosition,
        noPosition: positions.noPosition,
        funder: authority,
        systemProgram: SystemProgram.programId,
      })
      .rpc()
  }

  async function buy(
    market: MarketAddresses,
    buyer: Keypair,
    side: Side,
    amount: number,
  ): Promise<void> {
    const positions = deriveUser(
      program.programId,
      market.market,
      buyer.publicKey,
    )
    const method =
      side === "yes"
        ? program.methods.buyYes!(new BN(amount))
        : program.methods.buyNo!(new BN(amount))
    await method
      .accountsStrict({
        protocol,
        market: market.market,
        vault: market.vault,
        yesPosition: positions.yesPosition,
        noPosition: positions.noPosition,
        buyer: buyer.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([buyer])
      .rpc()
  }

  async function close(market: MarketAddresses): Promise<void> {
    await program.methods.closeMarket!()
      .accountsStrict({ protocol, market: market.market, closer: authority })
      .rpc()
  }

  async function resolve(
    market: MarketAddresses,
    decision: "yes" | "no" | "cancelled",
  ): Promise<void> {
    await program.methods.resolveMarket!({ [decision]: {} })
      .accountsStrict({
        protocol,
        market: market.market,
        resolver: resolver.publicKey,
      })
      .signers([resolver])
      .rpc()
  }

  async function settle(
    market: MarketAddresses,
    claimant: Keypair,
    instruction: "claim" | "refund",
  ): Promise<void> {
    const positions = deriveUser(
      program.programId,
      market.market,
      claimant.publicKey,
    )
    const method =
      instruction === "claim"
        ? program.methods.claimWinnings!()
        : program.methods.refundCancelled!()
    await method
      .accountsStrict({
        protocol,
        market: market.market,
        vault: market.vault,
        yesPosition: positions.yesPosition,
        noPosition: positions.noPosition,
        claimRecord: positions.claimRecord,
        claimant: claimant.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([claimant])
      .rpc()
  }

  beforeAll(async () => {
    await Promise.all(
      [resolver, outsider, yesBuyer, noBuyer, refundBuyer].map((wallet) =>
        airdrop(wallet.publicKey),
      ),
    )
  }, 60_000)

  it("initializes the protocol configuration", async () => {
    const programData = PublicKey.findProgramAddressSync(
      [program.programId.toBuffer()],
      BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
    )[0]

    await program.methods.initializeProtocol!(resolver.publicKey)
      .accountsStrict({
        protocol,
        authority,
        program: program.programId,
        programData,
        systemProgram: SystemProgram.programId,
      })
      .rpc()

    const data = await accountData(protocol)
    assert.equal(new PublicKey(data.subarray(8, 40)).equals(authority), true)
    assert.equal(
      new PublicKey(data.subarray(40, 72)).equals(resolver.publicKey),
      true,
    )
  })

  it("creates and funds YES, NO, and cancellation markets", async () => {
    closeTimestamp = Math.floor(Date.now() / 1000) + 8
    await createMarket(yesMarketId, yesMarket, "YES resolution market")
    await createMarket(noMarketId, noMarket, "NO resolution market")
    await createMarket(
      cancelledMarketId,
      cancelledMarket,
      "Cancelled resolution market",
    )

    await fundMarket(yesMarket, LAMPORTS_PER_SOL, LAMPORTS_PER_SOL)
    await fundMarket(noMarket, LAMPORTS_PER_SOL, LAMPORTS_PER_SOL)
    await fundMarket(
      cancelledMarket,
      LAMPORTS_PER_SOL / 2,
      LAMPORTS_PER_SOL / 2,
    )

    const market = decodeMarket(await accountData(yesMarket.market))
    assert.equal(market.status, 0)
    assert.equal(market.totalYes, BigInt(LAMPORTS_PER_SOL))
    assert.equal(market.totalNo, BigInt(LAMPORTS_PER_SOL))
    assert.equal(market.totalPool, BigInt(2 * LAMPORTS_PER_SOL))
  })

  it("rejects a zero-value purchase", async () => {
    const positions = deriveUser(
      program.programId,
      yesMarket.market,
      yesBuyer.publicKey,
    )
    await expectProgramError(
      program.methods.buyYes!(new BN(0))
        .accountsStrict({
          protocol,
          market: yesMarket.market,
          vault: yesMarket.vault,
          yesPosition: positions.yesPosition,
          noPosition: positions.noPosition,
          buyer: yesBuyer.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([yesBuyer])
        .rpc(),
      6006,
    )
  })

  it("rejects an incorrect position PDA", async () => {
    const correct = deriveUser(
      program.programId,
      yesMarket.market,
      yesBuyer.publicKey,
    )
    const wrong = deriveUser(
      program.programId,
      yesMarket.market,
      outsider.publicKey,
    )
    await expectProgramError(
      program.methods.buyYes!(new BN(1))
        .accountsStrict({
          protocol,
          market: yesMarket.market,
          vault: yesMarket.vault,
          yesPosition: wrong.yesPosition,
          noPosition: correct.noPosition,
          buyer: yesBuyer.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([yesBuyer])
        .rpc(),
      2006,
    )
  })

  it("records YES and NO purchases in lamports", async () => {
    await buy(yesMarket, yesBuyer, "yes", 2 * LAMPORTS_PER_SOL)
    await buy(yesMarket, noBuyer, "no", LAMPORTS_PER_SOL)
    await buy(noMarket, noBuyer, "no", 2 * LAMPORTS_PER_SOL)
    await buy(
      cancelledMarket,
      refundBuyer,
      "yes",
      Math.floor(0.4 * LAMPORTS_PER_SOL),
    )
    await buy(
      cancelledMarket,
      refundBuyer,
      "no",
      Math.floor(0.6 * LAMPORTS_PER_SOL),
    )

    const yesPosition = deriveUser(
      program.programId,
      yesMarket.market,
      yesBuyer.publicKey,
    ).yesPosition
    assert.equal(
      readPositionAmount(await accountData(yesPosition)),
      BigInt(2 * LAMPORTS_PER_SOL),
    )

    const market = decodeMarket(await accountData(yesMarket.market))
    assert.equal(market.totalYes, BigInt(3 * LAMPORTS_PER_SOL))
    assert.equal(market.totalNo, BigInt(2 * LAMPORTS_PER_SOL))
    assert.equal(market.totalPool, BigInt(5 * LAMPORTS_PER_SOL))
  })

  it("rejects resolution while the market is still open", async () => {
    await expectProgramError(
      program.methods.resolveMarket!({ yes: {} })
        .accountsStrict({
          protocol,
          market: yesMarket.market,
          resolver: resolver.publicKey,
        })
        .signers([resolver])
        .rpc(),
      6011,
    )
  })

  it("closes trading after the configured deadline", async () => {
    const delay = Math.max(0, closeTimestamp * 1000 - Date.now() + 1_200)
    await new Promise((resolveDelay) => setTimeout(resolveDelay, delay))

    await close(yesMarket)
    await close(noMarket)
    await close(cancelledMarket)

    const market = decodeMarket(await accountData(yesMarket.market))
    assert.equal(market.status, 1)
  })

  it("rejects trading after close", async () => {
    const positions = deriveUser(
      program.programId,
      yesMarket.market,
      yesBuyer.publicKey,
    )
    await expectProgramError(
      program.methods.buyYes!(new BN(1))
        .accountsStrict({
          protocol,
          market: yesMarket.market,
          vault: yesMarket.vault,
          yesPosition: positions.yesPosition,
          noPosition: positions.noPosition,
          buyer: yesBuyer.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([yesBuyer])
        .rpc(),
      6008,
    )
  })

  it("rejects an unauthorized resolver", async () => {
    await expectProgramError(
      program.methods.resolveMarket!({ yes: {} })
        .accountsStrict({
          protocol,
          market: yesMarket.market,
          resolver: outsider.publicKey,
        })
        .signers([outsider])
        .rpc(),
      6005,
    )
  })

  it("resolves markets to valid YES, NO, and CANCELLED outcomes", async () => {
    await resolve(yesMarket, "yes")
    await resolve(noMarket, "no")
    await resolve(cancelledMarket, "cancelled")

    const yesState = decodeMarket(await accountData(yesMarket.market))
    const noState = decodeMarket(await accountData(noMarket.market))
    const cancelledState = decodeMarket(
      await accountData(cancelledMarket.market),
    )
    assert.deepEqual([yesState.status, yesState.outcome], [2, 1])
    assert.deepEqual([noState.status, noState.outcome], [2, 2])
    assert.deepEqual([cancelledState.status, cancelledState.outcome], [3, 0])
  })

  it("rejects a losing claim", async () => {
    await expectProgramError(settle(yesMarket, noBuyer, "claim"), 6016)
  })

  it("pays a proportional YES winner and rejects a double claim", async () => {
    const addresses = deriveUser(
      program.programId,
      yesMarket.market,
      yesBuyer.publicKey,
    )
    await settle(yesMarket, yesBuyer, "claim")

    const claim = await accountData(addresses.claimRecord)
    const expectedPayout =
      (BigInt(2 * LAMPORTS_PER_SOL) * BigInt(5 * LAMPORTS_PER_SOL)) /
      BigInt(3 * LAMPORTS_PER_SOL)
    assert.equal(claim[CLAIM_KIND_OFFSET], 0)
    assert.equal(readU64(claim, CLAIM_AMOUNT_OFFSET), expectedPayout)

    await expectProgramError(settle(yesMarket, yesBuyer, "claim"), 6018)
  })

  it("pays a proportional NO winner", async () => {
    const addresses = deriveUser(
      program.programId,
      noMarket.market,
      noBuyer.publicKey,
    )
    await settle(noMarket, noBuyer, "claim")

    const claim = await accountData(addresses.claimRecord)
    const expectedPayout =
      (BigInt(2 * LAMPORTS_PER_SOL) * BigInt(4 * LAMPORTS_PER_SOL)) /
      BigInt(3 * LAMPORTS_PER_SOL)
    assert.equal(readU64(claim, CLAIM_AMOUNT_OFFSET), expectedPayout)
  })

  it("refunds both sides exactly when a market is cancelled", async () => {
    const addresses = deriveUser(
      program.programId,
      cancelledMarket.market,
      refundBuyer.publicKey,
    )
    await settle(cancelledMarket, refundBuyer, "refund")

    const claim = await accountData(addresses.claimRecord)
    assert.equal(claim[CLAIM_KIND_OFFSET], 1)
    assert.equal(readU64(claim, CLAIM_AMOUNT_OFFSET), BigInt(LAMPORTS_PER_SOL))

    const market = decodeMarket(await accountData(cancelledMarket.market))
    assert.equal(market.totalPaid, BigInt(LAMPORTS_PER_SOL))
  })
})
