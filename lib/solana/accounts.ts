import { Buffer } from "buffer"
import { PublicKey } from "@solana/web3.js"

import type { MarketOutcome, MarketStatus, TradeSide } from "../markets/types"

const ACCOUNT_DISCRIMINATORS = {
  market: Buffer.from([219, 190, 213, 55, 0, 227, 198, 154]),
  position: Buffer.from([170, 188, 143, 228, 122, 64, 247, 208]),
  claimRecord: Buffer.from([57, 229, 0, 9, 65, 62, 96, 7]),
} as const

export const CLIMATE_MARKET_ACCOUNT_SIZES = {
  market: 204,
  position: 82,
  claimRecord: 91,
} as const

const MARKET_STATUS: readonly MarketStatus[] = [
  "open",
  "closed",
  "resolved",
  "cancelled",
]
const MARKET_OUTCOME: readonly Exclude<MarketOutcome, "cancelled">[] = [
  "unresolved",
  "yes",
  "no",
]
const POSITION_SIDE: readonly TradeSide[] = ["yes", "no"]

function accountBuffer(
  data: Buffer | Uint8Array,
  minimumSize: number,
  discriminator: Buffer,
  label: string,
): Buffer {
  const value = Buffer.from(data)
  if (value.length < minimumSize) {
    throw new Error(`${label} account data is truncated.`)
  }
  if (!value.subarray(0, 8).equals(discriminator)) {
    throw new Error(`${label} account discriminator is invalid.`)
  }
  return value
}

function enumValue<T>(values: readonly T[], index: number, label: string): T {
  const value = values[index]
  if (value === undefined) throw new Error(`${label} enum value is invalid.`)
  return value
}

export interface DecodedMarketAccount {
  protocol: PublicKey
  authority: PublicKey
  resolver: PublicKey
  marketId: bigint
  questionHash: Buffer
  closeTimestamp: bigint
  resolutionTimestamp: bigint
  status: MarketStatus
  outcome: Exclude<MarketOutcome, "cancelled">
  totalYesAmount: bigint
  totalNoAmount: bigint
  totalPoolAmount: bigint
  totalPaidAmount: bigint
  resolvedAt: bigint
}

export function decodeMarketAccount(
  data: Buffer | Uint8Array,
): DecodedMarketAccount {
  const value = accountBuffer(
    data,
    CLIMATE_MARKET_ACCOUNT_SIZES.market,
    ACCOUNT_DISCRIMINATORS.market,
    "Market",
  )

  return {
    protocol: new PublicKey(value.subarray(8, 40)),
    authority: new PublicKey(value.subarray(40, 72)),
    resolver: new PublicKey(value.subarray(72, 104)),
    marketId: value.readBigUInt64LE(104),
    questionHash: Buffer.from(value.subarray(112, 144)),
    closeTimestamp: value.readBigInt64LE(144),
    resolutionTimestamp: value.readBigInt64LE(152),
    status: enumValue(MARKET_STATUS, value[160] ?? -1, "Market status"),
    outcome: enumValue(MARKET_OUTCOME, value[161] ?? -1, "Market outcome"),
    totalYesAmount: value.readBigUInt64LE(162),
    totalNoAmount: value.readBigUInt64LE(170),
    totalPoolAmount: value.readBigUInt64LE(178),
    totalPaidAmount: value.readBigUInt64LE(186),
    resolvedAt: value.readBigInt64LE(194),
  }
}

export interface DecodedPositionAccount {
  market: PublicKey
  owner: PublicKey
  side: TradeSide
  amount: bigint
}

export function decodePositionAccount(
  data: Buffer | Uint8Array,
): DecodedPositionAccount {
  const value = accountBuffer(
    data,
    CLIMATE_MARKET_ACCOUNT_SIZES.position,
    ACCOUNT_DISCRIMINATORS.position,
    "Position",
  )

  return {
    market: new PublicKey(value.subarray(8, 40)),
    owner: new PublicKey(value.subarray(40, 72)),
    side: enumValue(POSITION_SIDE, value[72] ?? -1, "Position side"),
    amount: value.readBigUInt64LE(73),
  }
}

export interface DecodedClaimRecordAccount {
  market: PublicKey
  owner: PublicKey
  claimed: boolean
  kind: "winnings" | "refund"
  amount: bigint
  claimedAt: bigint
}

export function decodeClaimRecordAccount(
  data: Buffer | Uint8Array,
): DecodedClaimRecordAccount {
  const value = accountBuffer(
    data,
    CLIMATE_MARKET_ACCOUNT_SIZES.claimRecord,
    ACCOUNT_DISCRIMINATORS.claimRecord,
    "Claim record",
  )
  const claimedByte = value[72]
  if (claimedByte !== 0 && claimedByte !== 1) {
    throw new Error("Claim record boolean value is invalid.")
  }

  return {
    market: new PublicKey(value.subarray(8, 40)),
    owner: new PublicKey(value.subarray(40, 72)),
    claimed: claimedByte === 1,
    kind: enumValue(
      ["winnings", "refund"] as const,
      value[73] ?? -1,
      "Claim kind",
    ),
    amount: value.readBigUInt64LE(74),
    claimedAt: value.readBigInt64LE(82),
  }
}
