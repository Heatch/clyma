import { Buffer } from "buffer"
import { PublicKey } from "@solana/web3.js"

import { marketIdToU64, u64ToBuffer, type U64Input } from "./encoding"

export type MarketSide = "yes" | "no"

export const BPF_LOADER_UPGRADEABLE_PROGRAM_ID = new PublicKey(
  "BPFLoaderUpgradeab1e11111111111111111111111",
)

export const PDA_SEEDS = {
  protocol: Buffer.from("protocol", "utf8"),
  market: Buffer.from("market", "utf8"),
  vault: Buffer.from("vault", "utf8"),
  yesPosition: Buffer.from("yes_position", "utf8"),
  noPosition: Buffer.from("no_position", "utf8"),
  claim: Buffer.from("claim", "utf8"),
} as const

export function deriveProtocolConfigPda(
  programId: PublicKey,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([PDA_SEEDS.protocol], programId)
}

/**
 * Derives the account that stores upgrade metadata for an upgradeable Solana
 * program. The protocol initializer uses this account to prove that its signer
 * is the program's upgrade authority.
 */
export function deriveProgramDataPda(
  programId: PublicKey,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [programId.toBuffer()],
    BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
  )
}

export function deriveMarketPda(
  programId: PublicKey,
  marketId: U64Input,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [PDA_SEEDS.market, u64ToBuffer(marketIdToU64(marketId), "market ID")],
    programId,
  )
}

export function deriveMarketVaultPda(
  programId: PublicKey,
  market: PublicKey,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [PDA_SEEDS.vault, market.toBuffer()],
    programId,
  )
}

export function derivePositionPda(
  programId: PublicKey,
  market: PublicKey,
  owner: PublicKey,
  side: MarketSide,
): [PublicKey, number] {
  const sideSeed = side === "yes" ? PDA_SEEDS.yesPosition : PDA_SEEDS.noPosition
  return PublicKey.findProgramAddressSync(
    [sideSeed, market.toBuffer(), owner.toBuffer()],
    programId,
  )
}

export function deriveClaimRecordPda(
  programId: PublicKey,
  market: PublicKey,
  owner: PublicKey,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [PDA_SEEDS.claim, market.toBuffer(), owner.toBuffer()],
    programId,
  )
}

export interface MarketProgramAddresses {
  protocolConfig: PublicKey
  market: PublicKey
  vault: PublicKey
  yesPosition: PublicKey
  noPosition: PublicKey
  claimRecord: PublicKey
}

export function deriveMarketProgramAddresses(
  programId: PublicKey,
  marketId: U64Input,
  owner: PublicKey,
): MarketProgramAddresses {
  const [protocolConfig] = deriveProtocolConfigPda(programId)
  const [market] = deriveMarketPda(programId, marketId)
  const [vault] = deriveMarketVaultPda(programId, market)
  const [yesPosition] = derivePositionPda(programId, market, owner, "yes")
  const [noPosition] = derivePositionPda(programId, market, owner, "no")
  const [claimRecord] = deriveClaimRecordPda(programId, market, owner)

  return {
    protocolConfig,
    market,
    vault,
    yesPosition,
    noPosition,
    claimRecord,
  }
}
