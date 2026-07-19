import Dashboard from "@/components/Dashboard"
import { initDb } from "@/lib/db/init"
import { queryMarkets } from "@/lib/db/repositories/markets"
import { demoMarkets } from "@/lib/markets/data"
import { cookies } from "next/headers"
import type { ClimateMarket } from "@/lib/markets/types"

export const dynamic = "force-dynamic"

export default async function HomePage() {
  const cookieStore = await cookies()
  const isDemo = cookieStore.get("demo")?.value === "1"

  let markets: ClimateMarket[]
  if (isDemo) {
    markets = demoMarkets
  } else {
    await initDb()
    const result = await queryMarkets({ limit: 24 })
    markets = result.markets
  }

  return <Dashboard initialMarkets={markets} isDemo={isDemo} />
}
