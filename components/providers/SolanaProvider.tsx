"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useState,
  type ReactNode,
} from "react"
import {
  WalletError,
  WalletNotConnectedError,
  WalletReadyState,
  type SendTransactionOptions,
} from "@solana/wallet-adapter-base"
import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom"
import {
  Connection,
  type PublicKey,
  type Transaction,
  type TransactionSignature,
  type VersionedTransaction,
} from "@solana/web3.js"

import { SOLANA_COMMITMENT, SOLANA_RPC_URL } from "@/lib/solana/config"

const SELECTED_WALLET_STORAGE_KEY = "terraform:devnet:selected-wallet"
const LEGACY_SELECTED_WALLET_STORAGE_KEY = "klashi:devnet:selected-wallet"

type SupportedTransaction = Transaction | VersionedTransaction
type SupportedWalletAdapter = PhantomWalletAdapter

export interface WalletOption {
  name: string
  icon: string
  url: string
  readyState: WalletReadyState
}

export interface AnchorCompatibleWallet {
  publicKey: PublicKey
  signTransaction<T extends SupportedTransaction>(transaction: T): Promise<T>
  signAllTransactions<T extends SupportedTransaction>(
    transactions: T[],
  ): Promise<T[]>
}

export interface SolanaWalletContextValue {
  connection: Connection
  wallets: readonly WalletOption[]
  selectedWalletName: string | null
  publicKey: PublicKey | null
  readyState: WalletReadyState | null
  connected: boolean
  connecting: boolean
  disconnecting: boolean
  error: WalletError | null
  anchorWallet: AnchorCompatibleWallet | null
  selectWallet: (name: string) => void
  connect: (name?: string) => Promise<void>
  disconnect: () => Promise<void>
  sendTransaction<T extends SupportedTransaction>(
    transaction: T,
    connection?: Connection,
    options?: SendTransactionOptions,
  ): Promise<TransactionSignature>
}

export interface SolanaProviderProps {
  children: ReactNode
  endpoint?: string
  autoConnect?: boolean
  onWalletError?: (error: WalletError) => void
}

const SolanaWalletContext = createContext<SolanaWalletContextValue | null>(null)

function toWalletError(error: unknown): WalletError {
  if (error instanceof WalletError) return error
  return new WalletError(
    error instanceof Error ? error.message : "Unexpected wallet error",
    error,
  )
}

/**
 * Lightweight, client-only Wallet Adapter context. It intentionally uses the
 * individual browser wallet adapter instead of pulling a mobile-oriented
 * React Native dependency tree into this browser-only application.
 */
export function SolanaProvider({
  children,
  endpoint = SOLANA_RPC_URL,
  autoConnect = true,
  onWalletError,
}: SolanaProviderProps) {
  const connection = useMemo(
    () =>
      new Connection(endpoint, {
        commitment: SOLANA_COMMITMENT,
        confirmTransactionInitialTimeout: 60_000,
      }),
    [endpoint],
  )
  const adapters = useMemo<readonly SupportedWalletAdapter[]>(
    () => (typeof window === "undefined" ? [] : [new PhantomWalletAdapter()]),
    [],
  )
  const [selectedWalletName, setSelectedWalletName] = useState<string | null>(
    null,
  )
  const [storageReady, setStorageReady] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)
  const [error, setError] = useState<WalletError | null>(null)
  const [revision, refreshAdapterState] = useReducer(
    (value: number) => value + 1,
    0,
  )

  const selectedAdapter = useMemo(
    () =>
      adapters.find((adapter) => adapter.name === selectedWalletName) ?? null,
    [adapters, selectedWalletName],
  )

  const reportError = useCallback(
    (nextError: unknown) => {
      const walletError = toWalletError(nextError)
      setError(walletError)
      onWalletError?.(walletError)
    },
    [onWalletError],
  )

  useEffect(() => {
    const storedName =
      window.localStorage.getItem(SELECTED_WALLET_STORAGE_KEY) ??
      window.localStorage.getItem(LEGACY_SELECTED_WALLET_STORAGE_KEY)
    if (storedName && adapters.some((adapter) => adapter.name === storedName)) {
      setSelectedWalletName(storedName)
      window.localStorage.setItem(SELECTED_WALLET_STORAGE_KEY, storedName)
    }
    setStorageReady(true)
  }, [adapters])

  useEffect(() => {
    const cleanups = adapters.map((adapter) => {
      const handleConnect = () => refreshAdapterState()
      const handleDisconnect = () => refreshAdapterState()
      const handleReadyStateChange = () => refreshAdapterState()
      const handleError = (nextError: WalletError) => {
        if (adapter.name === selectedWalletName) reportError(nextError)
      }

      adapter.on("connect", handleConnect)
      adapter.on("disconnect", handleDisconnect)
      adapter.on("readyStateChange", handleReadyStateChange)
      adapter.on("error", handleError)

      return () => {
        adapter.off("connect", handleConnect)
        adapter.off("disconnect", handleDisconnect)
        adapter.off("readyStateChange", handleReadyStateChange)
        adapter.off("error", handleError)
      }
    })

    return () => cleanups.forEach((cleanup) => cleanup())
  }, [adapters, reportError, selectedWalletName])

  useEffect(() => {
    if (
      !storageReady ||
      !autoConnect ||
      !selectedAdapter ||
      selectedAdapter.connected ||
      selectedAdapter.connecting ||
      selectedAdapter.readyState === WalletReadyState.NotDetected ||
      selectedAdapter.readyState === WalletReadyState.Unsupported
    ) {
      return
    }

    setConnecting(true)
    void selectedAdapter
      .autoConnect()
      .catch(reportError)
      .finally(() => {
        setConnecting(false)
        refreshAdapterState()
      })
  }, [autoConnect, reportError, selectedAdapter, storageReady])

  const selectWallet = useCallback(
    (name: string) => {
      const adapter = adapters.find((candidate) => candidate.name === name)
      if (!adapter) {
        reportError(new WalletError(`Unsupported wallet: ${name}`))
        return
      }

      if (
        selectedAdapter &&
        selectedAdapter !== adapter &&
        selectedAdapter.connected
      ) {
        void selectedAdapter.disconnect().catch(reportError)
      }

      setError(null)
      setSelectedWalletName(adapter.name)
      window.localStorage.setItem(SELECTED_WALLET_STORAGE_KEY, adapter.name)
      refreshAdapterState()
    },
    [adapters, reportError, selectedAdapter],
  )

  const connect = useCallback(
    async (name?: string) => {
      const adapter = name
        ? (adapters.find((candidate) => candidate.name === name) ?? null)
        : selectedAdapter

      if (!adapter) {
        const nextError = new WalletError("Select a wallet before connecting.")
        reportError(nextError)
        throw nextError
      }

      if (
        adapter.readyState === WalletReadyState.NotDetected ||
        adapter.readyState === WalletReadyState.Unsupported
      ) {
        const nextError = new WalletError(
          `${adapter.name} is not available in this browser.`,
        )
        reportError(nextError)
        throw nextError
      }

      if (adapter !== selectedAdapter) {
        setSelectedWalletName(adapter.name)
        window.localStorage.setItem(SELECTED_WALLET_STORAGE_KEY, adapter.name)
      }

      setError(null)
      setConnecting(true)
      refreshAdapterState()

      try {
        await adapter.connect()
      } catch (nextError) {
        reportError(nextError)
        throw toWalletError(nextError)
      } finally {
        setConnecting(false)
        refreshAdapterState()
      }
    },
    [adapters, reportError, selectedAdapter],
  )

  const disconnect = useCallback(async () => {
    if (!selectedAdapter) return

    setDisconnecting(true)
    setError(null)
    refreshAdapterState()

    try {
      await selectedAdapter.disconnect()
    } catch (nextError) {
      reportError(nextError)
      throw toWalletError(nextError)
    } finally {
      setDisconnecting(false)
      refreshAdapterState()
    }
  }, [reportError, selectedAdapter])

  const sendTransaction = useCallback(
    async <T extends SupportedTransaction>(
      transaction: T,
      connectionOverride = connection,
      options?: SendTransactionOptions,
    ): Promise<TransactionSignature> => {
      if (!selectedAdapter?.connected || !selectedAdapter.publicKey) {
        throw new WalletNotConnectedError()
      }

      return selectedAdapter.sendTransaction(
        transaction,
        connectionOverride,
        options,
      )
    },
    [connection, selectedAdapter],
  )

  const anchorWallet = useMemo<AnchorCompatibleWallet | null>(() => {
    void revision
    const publicKey = selectedAdapter?.publicKey
    if (!selectedAdapter?.connected || !publicKey) return null

    return {
      publicKey,
      signTransaction: <T extends SupportedTransaction>(transaction: T) =>
        selectedAdapter.signTransaction(transaction),
      signAllTransactions: <T extends SupportedTransaction>(
        transactions: T[],
      ) => selectedAdapter.signAllTransactions(transactions),
    }
    // revision reflects connect, disconnect, account, and readiness events.
  }, [revision, selectedAdapter])

  const wallets = useMemo<readonly WalletOption[]>(() => {
    void revision
    return adapters.map((adapter) => ({
      name: adapter.name,
      icon: adapter.icon,
      url: adapter.url,
      readyState: adapter.readyState,
    }))
  }, [adapters, revision])

  const value = useMemo<SolanaWalletContextValue>(() => {
    void revision
    return {
      connection,
      wallets,
      selectedWalletName,
      publicKey: selectedAdapter?.publicKey ?? null,
      readyState: selectedAdapter?.readyState ?? null,
      connected: Boolean(
        selectedAdapter?.connected && selectedAdapter.publicKey,
      ),
      connecting: connecting || Boolean(selectedAdapter?.connecting),
      disconnecting,
      error,
      anchorWallet,
      selectWallet,
      connect,
      disconnect,
      sendTransaction,
    }
  }, [
    anchorWallet,
    connect,
    connecting,
    connection,
    disconnect,
    disconnecting,
    error,
    revision,
    selectWallet,
    selectedAdapter,
    selectedWalletName,
    sendTransaction,
    wallets,
  ])

  return (
    <SolanaWalletContext.Provider value={value}>
      {children}
    </SolanaWalletContext.Provider>
  )
}

export function useSolanaWallet(): SolanaWalletContextValue {
  const value = useContext(SolanaWalletContext)
  if (!value) {
    throw new Error("useSolanaWallet must be used inside SolanaProvider.")
  }
  return value
}

export function useSolanaConnection(): { connection: Connection } {
  const { connection } = useSolanaWallet()
  return { connection }
}

export default SolanaProvider
