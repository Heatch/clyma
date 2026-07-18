"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { AnchorProvider } from "@coral-xyz/anchor"
import {
  Transaction,
  type Commitment,
  type TransactionInstruction,
} from "@solana/web3.js"

import { useSolanaWallet } from "@/components/providers/SolanaProvider"
import type { MarketStatus, TradeSide } from "@/lib/markets/types"
import { CLIMATE_MARKET_ACCOUNT_SIZES } from "@/lib/solana/accounts"
import {
  getExplorerTransactionUrl,
  SOLANA_COMMITMENT,
  SOLANA_PROGRAM_ID,
} from "@/lib/solana/config"
import {
  marketIdToU64,
  solToLamports,
  type U64Input,
} from "@/lib/solana/encoding"
import {
  MarketProgramClientError,
  toMarketProgramError,
} from "@/lib/solana/errors"
import {
  buildBuyInstruction,
  buildClaimWinningsInstruction,
  buildRefundCancelledInstruction,
} from "@/lib/solana/instructions"

export type MarketProgramAction = "buy_yes" | "buy_no" | "claim" | "refund"

export type MarketTransactionStatus =
  | "idle"
  | "preparing"
  | "simulating"
  | "awaiting_signature"
  | "confirming"
  | "success"
  | "error"

export interface MarketProgramReference {
  id: string
  onchainMarketId?: U64Input
  status?: MarketStatus
  closeTime?: string | Date
}

export interface MarketTransactionState {
  status: MarketTransactionStatus
  action: MarketProgramAction | null
  signature: string | null
  explorerUrl: string | null
  error: MarketProgramClientError | null
  feeLamports: number | null
  simulationLogs: readonly string[]
}

export interface MarketTransactionResult {
  signature: string
  explorerUrl: string
  feeLamports: number | null
}

const INITIAL_STATE: MarketTransactionState = {
  status: "idle",
  action: null,
  signature: null,
  explorerUrl: null,
  error: null,
  feeLamports: null,
  simulationLogs: [],
}

const PENDING_STATUSES: readonly MarketTransactionStatus[] = [
  "preparing",
  "simulating",
  "awaiting_signature",
  "confirming",
]

interface RentAccountSpec {
  instructionAccountIndex: number
  space: number
}

function ensureMarketCanTrade(market: MarketProgramReference): void {
  if (market.status && market.status !== "open") {
    throw new MarketProgramClientError(
      "market_not_open",
      `This market is ${market.status} and cannot accept new positions.`,
    )
  }

  if (!market.closeTime) return

  const closeTimestamp =
    market.closeTime instanceof Date
      ? market.closeTime.getTime()
      : Date.parse(market.closeTime)

  if (!Number.isFinite(closeTimestamp)) {
    throw new MarketProgramClientError(
      "configuration",
      "This market has an invalid closing time.",
    )
  }

  if (closeTimestamp <= Date.now()) {
    throw new MarketProgramClientError(
      "market_closed",
      "This market has reached its closing time.",
    )
  }
}

function simulationFailure(
  error: unknown,
  logs: readonly string[],
): MarketProgramClientError {
  const mapped = toMarketProgramError({
    message: `Transaction simulation failed: ${JSON.stringify(error)}`,
    logs,
  })

  if (mapped.code !== "unknown") return mapped

  return new MarketProgramClientError(
    "simulation_failed",
    "The Devnet transaction would fail, so it was not sent. Check the market state and try again.",
    { cause: error, logs },
  )
}

export function useMarketProgram(market: MarketProgramReference) {
  const wallet = useSolanaWallet()
  const { connection, anchorWallet } = wallet
  const [state, setState] = useState<MarketTransactionState>(INITIAL_STATE)
  const [balanceLamports, setBalanceLamports] = useState<bigint | null>(null)
  const submissionLockRef = useRef(false)

  const anchorProvider = useMemo(
    () =>
      anchorWallet
        ? new AnchorProvider(connection, anchorWallet, {
            commitment: SOLANA_COMMITMENT,
            preflightCommitment: SOLANA_COMMITMENT,
          })
        : null,
    [anchorWallet, connection],
  )

  const refreshBalance = useCallback(async (): Promise<bigint | null> => {
    if (!wallet.publicKey) {
      setBalanceLamports(null)
      return null
    }

    const nextBalance = BigInt(
      await connection.getBalance(wallet.publicKey, SOLANA_COMMITMENT),
    )
    setBalanceLamports(nextBalance)
    return nextBalance
  }, [connection, wallet.publicKey])

  useEffect(() => {
    if (!wallet.publicKey) {
      setBalanceLamports(null)
      return
    }

    void refreshBalance().catch(() => {
      setBalanceLamports(null)
    })

    const subscriptionId = connection.onAccountChange(
      wallet.publicKey,
      (accountInfo) => setBalanceLamports(BigInt(accountInfo.lamports)),
      SOLANA_COMMITMENT,
    )

    return () => {
      void connection.removeAccountChangeListener(subscriptionId)
    }
  }, [connection, refreshBalance, wallet.publicKey])

  const execute = useCallback(
    async (
      action: MarketProgramAction,
      createInstruction: () => TransactionInstruction,
      debitLamports = 0n,
      rentAccountSpecs: readonly RentAccountSpec[] = [],
    ): Promise<MarketTransactionResult> => {
      if (submissionLockRef.current) {
        throw new MarketProgramClientError(
          "duplicate_submission",
          "A market transaction is already in progress.",
        )
      }

      submissionLockRef.current = true
      setState({ ...INITIAL_STATE, status: "preparing", action })

      try {
        if (!SOLANA_PROGRAM_ID) {
          throw new MarketProgramClientError(
            "configuration",
            "The climate market program is not configured. Set NEXT_PUBLIC_PROGRAM_ID to its Devnet address.",
          )
        }

        if (!wallet.publicKey || !wallet.connected) {
          throw new MarketProgramClientError(
            "wallet_not_connected",
            "Connect a Solana wallet before submitting a transaction.",
          )
        }

        const instruction = createInstruction()
        const latestBlockhash =
          await connection.getLatestBlockhash(SOLANA_COMMITMENT)
        const transaction = new Transaction({
          feePayer: wallet.publicKey,
          blockhash: latestBlockhash.blockhash,
          lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
        }).add(instruction)

        const message = transaction.compileMessage()
        const feeResponse = await connection.getFeeForMessage(
          message,
          SOLANA_COMMITMENT,
        )
        const feeLamports = feeResponse.value

        let accountRentLamports = 0n
        if (rentAccountSpecs.length > 0) {
          const rentAddresses = rentAccountSpecs.map((spec) => {
            const account = instruction.keys[spec.instructionAccountIndex]
            if (!account) {
              throw new MarketProgramClientError(
                "configuration",
                "The market instruction is missing a required account.",
              )
            }
            return account.pubkey
          })
          const [rentAccounts, ...rentMinimums] = await Promise.all([
            connection.getMultipleAccountsInfo(
              rentAddresses,
              SOLANA_COMMITMENT,
            ),
            ...rentAccountSpecs.map((spec) =>
              connection.getMinimumBalanceForRentExemption(
                spec.space,
                SOLANA_COMMITMENT,
              ),
            ),
          ])

          accountRentLamports = rentAccounts.reduce(
            (total, account, index) =>
              account ? total : total + BigInt(rentMinimums[index] ?? 0),
            0n,
          )
        }

        if (debitLamports > 0n || accountRentLamports > 0n) {
          const currentBalance = await refreshBalance()
          const requiredLamports =
            debitLamports + accountRentLamports + BigInt(feeLamports ?? 0)

          if (currentBalance !== null && currentBalance < requiredLamports) {
            throw new MarketProgramClientError(
              "insufficient_balance",
              "The wallet does not have enough Devnet SOL for this action, its account rent, and the network fee.",
            )
          }
        }

        setState({
          ...INITIAL_STATE,
          status: "simulating",
          action,
          feeLamports,
        })

        const simulation = await connection.simulateTransaction(transaction)
        const simulationLogs = simulation.value.logs ?? []

        if (simulation.value.err) {
          throw simulationFailure(simulation.value.err, simulationLogs)
        }

        setState({
          ...INITIAL_STATE,
          status: "awaiting_signature",
          action,
          feeLamports,
          simulationLogs,
        })

        const signature = await wallet.sendTransaction(
          transaction,
          connection,
          {
            skipPreflight: false,
            preflightCommitment: SOLANA_COMMITMENT as Commitment,
            maxRetries: 3,
          },
        )
        const explorerUrl = getExplorerTransactionUrl(signature)

        setState({
          ...INITIAL_STATE,
          status: "confirming",
          action,
          signature,
          explorerUrl,
          feeLamports,
          simulationLogs,
        })

        const confirmation = await connection.confirmTransaction(
          {
            signature,
            blockhash: latestBlockhash.blockhash,
            lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
          },
          SOLANA_COMMITMENT,
        )

        if (confirmation.value.err) {
          throw toMarketProgramError({
            message: `The confirmed transaction failed: ${JSON.stringify(confirmation.value.err)}`,
            logs: simulationLogs,
          })
        }

        setState({
          ...INITIAL_STATE,
          status: "success",
          action,
          signature,
          explorerUrl,
          feeLamports,
          simulationLogs,
        })

        void refreshBalance().catch(() => undefined)
        if (typeof window !== "undefined") {
          window.dispatchEvent(new Event("terraform:market-state-changed"))
        }

        return { signature, explorerUrl, feeLamports }
      } catch (error) {
        const mappedError = toMarketProgramError(error)
        setState((current) => ({
          ...current,
          status: "error",
          error: mappedError,
        }))
        throw mappedError
      } finally {
        submissionLockRef.current = false
      }
    },
    [connection, refreshBalance, wallet],
  )

  const marketId = useCallback(
    () => marketIdToU64(market.onchainMarketId ?? market.id),
    [market.id, market.onchainMarketId],
  )

  const buy = useCallback(
    async (
      side: TradeSide,
      amountSol: string | number,
    ): Promise<MarketTransactionResult> => {
      ensureMarketCanTrade(market)
      const amountLamports = solToLamports(amountSol)

      if (amountLamports === 0n) {
        throw new MarketProgramClientError(
          "invalid_amount",
          "Purchase amount must be greater than zero.",
        )
      }

      return execute(
        side === "yes" ? "buy_yes" : "buy_no",
        () => {
          if (!wallet.publicKey) {
            throw new MarketProgramClientError(
              "wallet_not_connected",
              "Connect a Solana wallet before submitting a transaction.",
            )
          }

          return buildBuyInstruction({
            marketId: marketId(),
            owner: wallet.publicKey,
            side,
            amountLamports,
          })
        },
        amountLamports,
        [
          {
            instructionAccountIndex: 3,
            space: CLIMATE_MARKET_ACCOUNT_SIZES.position,
          },
          {
            instructionAccountIndex: 4,
            space: CLIMATE_MARKET_ACCOUNT_SIZES.position,
          },
        ],
      )
    },
    [execute, market, marketId, wallet.publicKey],
  )

  const claim = useCallback(async (): Promise<MarketTransactionResult> => {
    if (market.status && market.status !== "resolved") {
      throw new MarketProgramClientError(
        "market_not_open",
        "Winnings can only be claimed after the market is resolved.",
      )
    }

    return execute(
      "claim",
      () => {
        if (!wallet.publicKey) {
          throw new MarketProgramClientError(
            "wallet_not_connected",
            "Connect a Solana wallet before claiming winnings.",
          )
        }

        return buildClaimWinningsInstruction({
          marketId: marketId(),
          owner: wallet.publicKey,
        })
      },
      0n,
      [
        {
          instructionAccountIndex: 5,
          space: CLIMATE_MARKET_ACCOUNT_SIZES.claimRecord,
        },
      ],
    )
  }, [execute, market.status, marketId, wallet.publicKey])

  const refund = useCallback(async (): Promise<MarketTransactionResult> => {
    if (market.status && market.status !== "cancelled") {
      throw new MarketProgramClientError(
        "market_not_open",
        "Refunds are only available for cancelled markets.",
      )
    }

    return execute(
      "refund",
      () => {
        if (!wallet.publicKey) {
          throw new MarketProgramClientError(
            "wallet_not_connected",
            "Connect a Solana wallet before requesting a refund.",
          )
        }

        return buildRefundCancelledInstruction({
          marketId: marketId(),
          owner: wallet.publicKey,
        })
      },
      0n,
      [
        {
          instructionAccountIndex: 5,
          space: CLIMATE_MARKET_ACCOUNT_SIZES.claimRecord,
        },
      ],
    )
  }, [execute, market.status, marketId, wallet.publicKey])

  const reset = useCallback(() => {
    if (!submissionLockRef.current) setState(INITIAL_STATE)
  }, [])

  const isPending = PENDING_STATUSES.includes(state.status)

  return {
    anchorProvider,
    balanceLamports,
    buy,
    claim,
    refund,
    refreshBalance,
    reset,
    state,
    isPending,
    isConfigured: SOLANA_PROGRAM_ID !== null,
    programId: SOLANA_PROGRAM_ID,
  }
}

export default useMarketProgram
