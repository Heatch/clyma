import { BN, BorshInstructionCoder } from "@coral-xyz/anchor"
import { Buffer } from "buffer"
import {
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  type AccountMeta,
} from "@solana/web3.js"

import { requireProgramId, SOLANA_PROGRAM_ID } from "./config"
import { marketIdToU64, toU64, U64_MAX, type U64Input } from "./encoding"
import { CLIMATE_MARKET_IDL } from "./idl"
import {
  deriveMarketPda,
  deriveMarketProgramAddresses,
  deriveMarketVaultPda,
  derivePositionPda,
  deriveProgramDataPda,
  deriveProtocolConfigPda,
  type MarketProgramAddresses,
  type MarketSide,
} from "./pdas"

const instructionCoder = new BorshInstructionCoder(CLIMATE_MARKET_IDL)

export interface MarketInstructionContext {
  marketId: U64Input
  owner: PublicKey
  programId?: PublicKey | null
  addresses?: MarketProgramAddresses
}

export interface BuyInstructionInput extends MarketInstructionContext {
  side: MarketSide
  amountLamports: U64Input
}

export type I64Input = bigint | number | string
export type ResolutionDecision = "yes" | "no" | "cancelled"
export type QuestionHashInput = Uint8Array | readonly number[]

interface ProgramInstructionContext {
  programId?: PublicKey | null
}

interface OperatorMarketInstructionContext extends ProgramInstructionContext {
  marketId: U64Input
  protocolConfig?: PublicKey
  market?: PublicKey
}

export interface InitializeProtocolInstructionInput extends ProgramInstructionContext {
  authority: PublicKey
  resolver: PublicKey
  protocolConfig?: PublicKey
  programData?: PublicKey
}

export interface CreateMarketInstructionInput extends OperatorMarketInstructionContext {
  authority: PublicKey
  questionHash: QuestionHashInput
  closeTimestamp: I64Input
  resolutionTimestamp: I64Input
  vault?: PublicKey
}

export interface FundMarketInstructionInput extends OperatorMarketInstructionContext {
  funder: PublicKey
  yesAmountLamports: U64Input
  noAmountLamports: U64Input
  vault?: PublicKey
  yesPosition?: PublicKey
  noPosition?: PublicKey
}

export interface CloseMarketInstructionInput extends OperatorMarketInstructionContext {
  closer: PublicKey
}

export interface ResolveMarketInstructionInput extends OperatorMarketInstructionContext {
  resolver: PublicKey
  decision: ResolutionDecision
}

const I64_MIN = -(1n << 63n)
const I64_MAX = (1n << 63n) - 1n

function readonly(pubkey: PublicKey, isSigner = false): AccountMeta {
  return { pubkey, isSigner, isWritable: false }
}

function writable(pubkey: PublicKey, isSigner = false): AccountMeta {
  return { pubkey, isSigner, isWritable: true }
}

function getProgramId(input: ProgramInstructionContext): PublicKey {
  return requireProgramId(input.programId ?? SOLANA_PROGRAM_ID)
}

function toI64(value: I64Input, label: string): bigint {
  let parsed: bigint

  if (typeof value === "bigint") {
    parsed = value
  } else if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      throw new RangeError(`${label} must be a safe integer.`)
    }
    parsed = BigInt(value)
  } else {
    const normalized = value.trim()
    if (!/^-?\d+$/.test(normalized)) {
      throw new TypeError(`${label} must be an integer.`)
    }
    parsed = BigInt(normalized)
  }

  if (parsed < I64_MIN || parsed > I64_MAX) {
    throw new RangeError(`${label} must fit in a signed 64-bit integer.`)
  }

  return parsed
}

function normalizeQuestionHash(input: QuestionHashInput): number[] {
  const bytes = Array.from(input)
  if (bytes.length !== 32) {
    throw new RangeError("Question hash must contain exactly 32 bytes.")
  }
  if (bytes.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 255)) {
    throw new RangeError("Question hash must contain only byte values.")
  }
  if (bytes.every((byte) => byte === 0)) {
    throw new RangeError("Question hash must not be all zeroes.")
  }
  return bytes
}

function getOperatorMarketAccounts(input: OperatorMarketInstructionContext): {
  programId: PublicKey
  marketId: bigint
  protocolConfig: PublicKey
  market: PublicKey
} {
  const programId = getProgramId(input)
  const marketId = marketIdToU64(input.marketId)
  const protocolConfig =
    input.protocolConfig ?? deriveProtocolConfigPda(programId)[0]
  const market = input.market ?? deriveMarketPda(programId, marketId)[0]

  return { programId, marketId, protocolConfig, market }
}

function getContext(input: MarketInstructionContext): {
  programId: PublicKey
  addresses: MarketProgramAddresses
} {
  const programId = requireProgramId(input.programId ?? SOLANA_PROGRAM_ID)
  const addresses =
    input.addresses ??
    deriveMarketProgramAddresses(programId, input.marketId, input.owner)

  return { programId, addresses }
}

function encode(name: string, args: Record<string, unknown>): Buffer {
  const data = instructionCoder.encode(name, args)
  if (!data) {
    throw new Error(`Unable to encode the ${name} Anchor instruction.`)
  }
  return data
}

export function buildInitializeProtocolInstruction(
  input: InitializeProtocolInstructionInput,
): TransactionInstruction {
  const programId = getProgramId(input)
  if (input.resolver.equals(PublicKey.default)) {
    throw new RangeError("Resolver must not be the default public key.")
  }

  const protocolConfig =
    input.protocolConfig ?? deriveProtocolConfigPda(programId)[0]
  const programData = input.programData ?? deriveProgramDataPda(programId)[0]

  return new TransactionInstruction({
    programId,
    keys: [
      writable(protocolConfig),
      writable(input.authority, true),
      readonly(programId),
      readonly(programData),
      readonly(SystemProgram.programId),
    ],
    data: encode("initializeProtocol", { resolver: input.resolver }),
  })
}

export function buildCreateMarketInstruction(
  input: CreateMarketInstructionInput,
): TransactionInstruction {
  const { programId, marketId, protocolConfig, market } =
    getOperatorMarketAccounts(input)
  const questionHash = normalizeQuestionHash(input.questionHash)
  const closeTimestamp = toI64(input.closeTimestamp, "close timestamp")
  const resolutionTimestamp = toI64(
    input.resolutionTimestamp,
    "resolution timestamp",
  )
  if (resolutionTimestamp < closeTimestamp) {
    throw new RangeError(
      "Resolution timestamp must be greater than or equal to the close timestamp.",
    )
  }
  const vault = input.vault ?? deriveMarketVaultPda(programId, market)[0]

  return new TransactionInstruction({
    programId,
    keys: [
      writable(protocolConfig),
      writable(market),
      writable(vault),
      writable(input.authority, true),
      readonly(SystemProgram.programId),
    ],
    data: encode("createMarket", {
      marketId: new BN(marketId.toString()),
      questionHash,
      closeTimestamp: new BN(closeTimestamp.toString()),
      resolutionTimestamp: new BN(resolutionTimestamp.toString()),
    }),
  })
}

export function buildFundMarketInstruction(
  input: FundMarketInstructionInput,
): TransactionInstruction {
  const { programId, protocolConfig, market } = getOperatorMarketAccounts(input)
  const yesAmount = toU64(input.yesAmountLamports, "YES funding amount")
  const noAmount = toU64(input.noAmountLamports, "NO funding amount")
  const totalAmount = yesAmount + noAmount
  if (totalAmount === 0n) {
    throw new RangeError("Market funding must be greater than zero.")
  }
  if (totalAmount > U64_MAX) {
    throw new RangeError("Combined market funding must fit in a u64.")
  }

  const vault = input.vault ?? deriveMarketVaultPda(programId, market)[0]
  const yesPosition =
    input.yesPosition ??
    derivePositionPda(programId, market, input.funder, "yes")[0]
  const noPosition =
    input.noPosition ??
    derivePositionPda(programId, market, input.funder, "no")[0]

  return new TransactionInstruction({
    programId,
    keys: [
      readonly(protocolConfig),
      writable(market),
      writable(vault),
      writable(yesPosition),
      writable(noPosition),
      writable(input.funder, true),
      readonly(SystemProgram.programId),
    ],
    data: encode("fundMarket", {
      yesAmount: new BN(yesAmount.toString()),
      noAmount: new BN(noAmount.toString()),
    }),
  })
}

export function buildCloseMarketInstruction(
  input: CloseMarketInstructionInput,
): TransactionInstruction {
  const { programId, protocolConfig, market } = getOperatorMarketAccounts(input)

  return new TransactionInstruction({
    programId,
    keys: [
      readonly(protocolConfig),
      writable(market),
      readonly(input.closer, true),
    ],
    data: encode("closeMarket", {}),
  })
}

export function buildResolveMarketInstruction(
  input: ResolveMarketInstructionInput,
): TransactionInstruction {
  if (
    input.decision !== "yes" &&
    input.decision !== "no" &&
    input.decision !== "cancelled"
  ) {
    throw new TypeError("Resolution decision must be yes, no, or cancelled.")
  }

  const { programId, protocolConfig, market } = getOperatorMarketAccounts(input)

  return new TransactionInstruction({
    programId,
    keys: [
      readonly(protocolConfig),
      writable(market),
      readonly(input.resolver, true),
    ],
    data: encode("resolveMarket", {
      decision: { [input.decision]: {} },
    }),
  })
}

export function buildBuyInstruction(
  input: BuyInstructionInput,
): TransactionInstruction {
  const { programId, addresses } = getContext(input)
  const amount = toU64(input.amountLamports, "purchase amount")

  if (amount === 0n) {
    throw new RangeError("Purchase amount must be greater than zero.")
  }

  const instructionName = input.side === "yes" ? "buyYes" : "buyNo"

  return new TransactionInstruction({
    programId,
    keys: [
      readonly(addresses.protocolConfig),
      writable(addresses.market),
      writable(addresses.vault),
      writable(addresses.yesPosition),
      writable(addresses.noPosition),
      writable(input.owner, true),
      readonly(SystemProgram.programId),
    ],
    data: encode(instructionName, { amount: new BN(amount.toString()) }),
  })
}

export function buildClaimWinningsInstruction(
  input: MarketInstructionContext,
): TransactionInstruction {
  const { programId, addresses } = getContext(input)

  return new TransactionInstruction({
    programId,
    keys: [
      readonly(addresses.protocolConfig),
      writable(addresses.market),
      writable(addresses.vault),
      readonly(addresses.yesPosition),
      readonly(addresses.noPosition),
      writable(addresses.claimRecord),
      writable(input.owner, true),
      readonly(SystemProgram.programId),
    ],
    data: encode("claimWinnings", {}),
  })
}

export function buildRefundCancelledInstruction(
  input: MarketInstructionContext,
): TransactionInstruction {
  const { programId, addresses } = getContext(input)

  return new TransactionInstruction({
    programId,
    keys: [
      readonly(addresses.protocolConfig),
      writable(addresses.market),
      writable(addresses.vault),
      readonly(addresses.yesPosition),
      readonly(addresses.noPosition),
      writable(addresses.claimRecord),
      writable(input.owner, true),
      readonly(SystemProgram.programId),
    ],
    data: encode("refundCancelled", {}),
  })
}
