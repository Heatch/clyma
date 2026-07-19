import React from "react"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { vi } from "vitest"

import PredictionForm from "@/components/trading/PredictionForm"
import type { ClimateMarket } from "@/lib/markets/types"

const controls = vi.hoisted(() => ({
  connected: true,
  configured: true,
  mode: "success" as "success" | "failure" | "pending",
  balanceLamports: 2_000_000_000n as bigint | null,
  recordPurchase: vi.fn(),
}))

vi.mock("@/components/providers/SolanaProvider", () => ({
  useSolanaWallet: () => ({
    connected: controls.connected,
    publicKey: controls.connected
      ? { toBase58: () => "7YttLkHDoNj9wyDur5cGrEEhJvJ2Sfg9c5C9fHgwmEED" }
      : null,
  }),
}))

vi.mock("@/components/providers/PositionProvider", () => ({
  usePositions: () => ({
    positions: [],
    recordPurchase: controls.recordPurchase,
  }),
}))

vi.mock("@/hooks/useMarketProgram", async () => {
  const React = await vi.importActual<typeof import("react")>("react")
  const signature = "5".repeat(88)
  const initialState: {
    status: string
    action: string | null
    signature: string | null
    explorerUrl: string | null
    error: Error | null
    feeLamports: number | null
    simulationLogs: string[]
  } = {
    status: "idle",
    action: null,
    signature: null,
    explorerUrl: null,
    error: null,
    feeLamports: null,
    simulationLogs: [],
  }

  function useMockMarketProgram() {
    const [state, setState] = React.useState(initialState)
    const pending = [
      "preparing",
      "simulating",
      "awaiting_signature",
      "confirming",
    ].includes(state.status)
    return {
      buy: async () => {
        setState({ ...initialState, status: "preparing", action: "buy_yes" })
        if (controls.mode === "pending") return new Promise(() => undefined)
        await Promise.resolve()
        if (controls.mode === "failure") {
          const error = new Error("Wallet rejected the demo transaction.")
          setState({
            ...initialState,
            status: "error",
            action: "buy_yes",
            error,
          })
          throw error
        }
        setState({
          ...initialState,
          status: "success",
          action: "buy_yes",
          signature,
          explorerUrl: `https://explorer.solana.com/tx/${signature}?cluster=devnet`,
          feeLamports: 5000,
        })
        return {
          signature,
          explorerUrl: `https://explorer.solana.com/tx/${signature}?cluster=devnet`,
          feeLamports: 5000,
        }
      },
      balanceLamports: controls.balanceLamports,
      state,
      isPending: pending,
      isConfigured: controls.configured,
      reset: () => setState(initialState),
    }
  }

  return {
    default: useMockMarketProgram,
  }
})

const openMarket: ClimateMarket = {
  id: "test-market-1",
  onchainMarketId: 1001,
  question: "Will Florida record a Category 4+ hurricane landfall before October 31, 2026?",
  slug: "fl-test",
  description: "A test market.",
  category: "hurricane",
  continent: "North America",
  country: "United States",
  region: "Florida",
  latitude: 27.6648,
  longitude: -81.5158,
  closeTime: "2099-12-31T23:59:59.000Z",
  resolutionTime: "2100-01-14T18:00:00.000Z",
  status: "open",
  outcome: "unresolved",
  yesPrice: 0.43,
  noPrice: 0.57,
  yesLiquidity: 430,
  noLiquidity: 570,
  totalVolume: 2840,
  participants: 184,
  resolutionSource: "NOAA",
  resolutionSourceUrl: "https://www.nhc.noaa.gov/",
  resolutionRules: "Resolve YES if a Category 4+ hurricane makes landfall in Florida before the close time.",
  resolver: "3mshx6HoZop71xQ483kLMdiUuXQ1UxDgBABuLnFkVfDV",
  createdAt: "2026-05-01T14:00:00.000Z",
  featured: true,
  trendingScore: 96,
  history: [],
  evidence: [],
  recentTrades: [],
  network: "devnet",
  settlementAsset: "SOL",
  marketModel: "pooled-binary",
  isDemo: false,
  dataLabel: "",
  dataDisclaimer: "",
  chainState: "synced",
}

describe("prediction purchase controls", () => {
  beforeEach(() => {
    controls.connected = true
    controls.configured = true
    controls.mode = "success"
    controls.balanceLamports = 2_000_000_000n
    controls.recordPurchase.mockReset()
  })

  it("shows the wallet-not-connected state", () => {
    controls.connected = false
    render(<PredictionForm market={openMarket} />)
    expect(
      screen.getByText(/connect a solana wallet to purchase/i),
    ).toBeInTheDocument()
    expect(screen.getByTestId("review-transaction")).toBeDisabled()
  })

  it("validates zero and over-balance amounts", async () => {
    const user = userEvent.setup()
    render(<PredictionForm market={openMarket} />)
    const input = screen.getByTestId("trade-amount")

    await user.clear(input)
    await user.type(input, "0")
    expect(
      screen.getByText(/amount must be greater than zero/i),
    ).toBeInTheDocument()

    await user.clear(input)
    await user.type(input, "3")
    expect(screen.getByText(/exceeds your wallet balance/i)).toBeInTheDocument()
  })

  it("shows a transaction loading state and prevents duplicate confirmation", async () => {
    controls.mode = "pending"
    const user = userEvent.setup()
    render(<PredictionForm market={openMarket} />)
    await user.click(screen.getByTestId("review-transaction"))
    await user.click(screen.getByTestId("confirm-transaction"))
    expect(await screen.findByRole("status")).toHaveTextContent(
      /preparing accounts/i,
    )
    expect(screen.getByTestId("confirm-transaction")).toBeDisabled()
  })

  it("displays a successful transaction and records the resulting position", async () => {
    const user = userEvent.setup()
    render(<PredictionForm market={openMarket} />)
    await user.click(screen.getByTestId("review-transaction"))
    await user.click(screen.getByTestId("confirm-transaction"))
    expect(await screen.findByText(/position recorded/i)).toBeInTheDocument()
    expect(
      screen.getByRole("link", { name: /view transaction/i }),
    ).toHaveAttribute("href", expect.stringContaining("cluster=devnet"))
    expect(controls.recordPurchase).toHaveBeenCalledTimes(1)
  })

  it("displays a useful failed transaction state", async () => {
    controls.mode = "failure"
    const user = userEvent.setup()
    render(<PredictionForm market={openMarket} />)
    await user.click(screen.getByTestId("review-transaction"))
    await user.click(screen.getByTestId("confirm-transaction"))
    expect(await screen.findByText(/transaction failed/i)).toBeInTheDocument()
    expect(
      screen.getByText(/wallet rejected the demo transaction/i),
    ).toBeInTheDocument()
  })

  it("prevents purchases on a closed market", () => {
    render(<PredictionForm market={{ ...openMarket, status: "closed" }} />)
    expect(screen.getByText(/market is closed/i)).toBeInTheDocument()
    expect(screen.getByTestId("review-transaction")).toBeDisabled()
  })
})
