import type { Idl } from "@coral-xyz/anchor"

import { SOLANA_PROGRAM_ID } from "./config"

const FALLBACK_IDL_ADDRESS = "11111111111111111111111111111111"

/**
 * Anchor 0.30-compatible client IDL for the climate_market program. The deployed
 * address is injected from NEXT_PUBLIC_PROGRAM_ID; the System Program address is
 * used only as a valid placeholder while the prototype is unconfigured.
 */
export const CLIMATE_MARKET_IDL: Idl = {
  address: SOLANA_PROGRAM_ID?.toBase58() ?? FALLBACK_IDL_ADDRESS,
  metadata: {
    name: "climate_market",
    version: "0.1.0",
    spec: "0.1.0",
    description: "Pooled binary climate prediction markets on Solana Devnet",
  },
  instructions: [
    {
      name: "initializeProtocol",
      discriminator: [188, 233, 252, 106, 134, 146, 202, 91],
      accounts: [
        { name: "protocol", writable: true },
        { name: "authority", writable: true, signer: true },
        { name: "program" },
        { name: "programData" },
        { name: "systemProgram" },
      ],
      args: [{ name: "resolver", type: "pubkey" }],
    },
    {
      name: "createMarket",
      discriminator: [103, 226, 97, 235, 200, 188, 251, 254],
      accounts: [
        { name: "protocol", writable: true },
        { name: "market", writable: true },
        { name: "vault", writable: true },
        { name: "authority", writable: true, signer: true },
        { name: "systemProgram" },
      ],
      args: [
        { name: "marketId", type: "u64" },
        { name: "questionHash", type: { array: ["u8", 32] } },
        { name: "closeTimestamp", type: "i64" },
        { name: "resolutionTimestamp", type: "i64" },
      ],
    },
    {
      name: "fundMarket",
      discriminator: [173, 177, 32, 57, 20, 248, 119, 160],
      accounts: [
        { name: "protocol" },
        { name: "market", writable: true },
        { name: "vault", writable: true },
        { name: "yesPosition", writable: true },
        { name: "noPosition", writable: true },
        { name: "funder", writable: true, signer: true },
        { name: "systemProgram" },
      ],
      args: [
        { name: "yesAmount", type: "u64" },
        { name: "noAmount", type: "u64" },
      ],
    },
    {
      name: "buyYes",
      discriminator: [124, 76, 113, 130, 177, 112, 187, 104],
      accounts: [
        { name: "protocol" },
        { name: "market", writable: true },
        { name: "vault", writable: true },
        { name: "yesPosition", writable: true },
        { name: "noPosition", writable: true },
        { name: "buyer", writable: true, signer: true },
        { name: "systemProgram" },
      ],
      args: [{ name: "amount", type: "u64" }],
    },
    {
      name: "buyNo",
      discriminator: [89, 240, 244, 16, 196, 201, 190, 163],
      accounts: [
        { name: "protocol" },
        { name: "market", writable: true },
        { name: "vault", writable: true },
        { name: "yesPosition", writable: true },
        { name: "noPosition", writable: true },
        { name: "buyer", writable: true, signer: true },
        { name: "systemProgram" },
      ],
      args: [{ name: "amount", type: "u64" }],
    },
    {
      name: "closeMarket",
      discriminator: [88, 154, 248, 186, 48, 14, 123, 244],
      accounts: [
        { name: "protocol" },
        { name: "market", writable: true },
        { name: "closer", signer: true },
      ],
      args: [],
    },
    {
      name: "resolveMarket",
      discriminator: [155, 23, 80, 173, 46, 74, 23, 239],
      accounts: [
        { name: "protocol" },
        { name: "market", writable: true },
        { name: "resolver", signer: true },
      ],
      args: [
        {
          name: "decision",
          type: { defined: { name: "ResolutionDecision" } },
        },
      ],
    },
    {
      name: "claimWinnings",
      discriminator: [161, 215, 24, 59, 14, 236, 242, 221],
      accounts: [
        { name: "protocol" },
        { name: "market", writable: true },
        { name: "vault", writable: true },
        { name: "yesPosition" },
        { name: "noPosition" },
        { name: "claimRecord", writable: true },
        { name: "claimant", writable: true, signer: true },
        { name: "systemProgram" },
      ],
      args: [],
    },
    {
      name: "refundCancelled",
      discriminator: [103, 244, 158, 83, 225, 80, 56, 62],
      accounts: [
        { name: "protocol" },
        { name: "market", writable: true },
        { name: "vault", writable: true },
        { name: "yesPosition" },
        { name: "noPosition" },
        { name: "claimRecord", writable: true },
        { name: "claimant", writable: true, signer: true },
        { name: "systemProgram" },
      ],
      args: [],
    },
  ],
  types: [
    {
      name: "ResolutionDecision",
      type: {
        kind: "enum",
        variants: [{ name: "yes" }, { name: "no" }, { name: "cancelled" }],
      },
    },
  ],
  errors: [
    {
      code: 6000,
      name: "InvalidResolver",
      msg: "The resolver address is invalid",
    },
    {
      code: 6001,
      name: "InvalidQuestionHash",
      msg: "The question hash is invalid",
    },
    {
      code: 6002,
      name: "InvalidCloseTimestamp",
      msg: "The close timestamp is invalid",
    },
    {
      code: 6003,
      name: "InvalidResolutionTimestamp",
      msg: "The resolution timestamp is invalid",
    },
    {
      code: 6004,
      name: "UnauthorizedAuthority",
      msg: "Unauthorized protocol authority",
    },
    {
      code: 6005,
      name: "UnauthorizedResolver",
      msg: "Unauthorized market resolver",
    },
    {
      code: 6006,
      name: "ZeroAmount",
      msg: "The amount must be greater than zero",
    },
    {
      code: 6007,
      name: "ZeroFunding",
      msg: "Funding must be greater than zero",
    },
    { code: 6008, name: "MarketNotOpen", msg: "The market is not open" },
    {
      code: 6009,
      name: "TradingClosed",
      msg: "The market trading deadline has passed",
    },
    { code: 6010, name: "TradingStillOpen", msg: "The market is still open" },
    { code: 6011, name: "MarketNotClosed", msg: "The market is not closed" },
    {
      code: 6012,
      name: "ResolutionTooEarly",
      msg: "The market cannot be resolved yet",
    },
    {
      code: 6013,
      name: "NoWinningLiquidity",
      msg: "The winning side has no liquidity",
    },
    {
      code: 6014,
      name: "MarketNotResolved",
      msg: "The market is not resolved",
    },
    {
      code: 6015,
      name: "MarketNotCancelled",
      msg: "The market is not cancelled",
    },
    {
      code: 6016,
      name: "LosingPosition",
      msg: "The position is not on the winning side",
    },
    {
      code: 6017,
      name: "NothingToRefund",
      msg: "There is no balance to refund",
    },
    {
      code: 6018,
      name: "AlreadyClaimed",
      msg: "The position was already settled",
    },
    {
      code: 6019,
      name: "InvalidPosition",
      msg: "The position account is invalid",
    },
    {
      code: 6020,
      name: "InvalidMarketVault",
      msg: "The market vault is invalid",
    },
    { code: 6021, name: "InvalidMarket", msg: "The market account is invalid" },
    {
      code: 6022,
      name: "InvalidClaimRecord",
      msg: "The claim record is invalid",
    },
    {
      code: 6023,
      name: "InsufficientFunds",
      msg: "The wallet has insufficient funds",
    },
    {
      code: 6024,
      name: "VaultInsufficientFunds",
      msg: "The market vault has insufficient funds",
    },
    { code: 6025, name: "MathOverflow", msg: "Arithmetic overflow" },
  ],
}

export type ClimateMarketIdl = typeof CLIMATE_MARKET_IDL
