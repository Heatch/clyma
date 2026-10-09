import Dashboard from "@/components/Dashboard"
import { initDb } from "@/lib/db/init"
import { queryMarkets } from "@/lib/db/repositories/markets"

export const dynamic = "force-dynamic"

export default async function HomePage() {
  await initDb()
  const result = await queryMarkets({ limit: 100 })

  return <Dashboard initialMarkets={result.markets} />
}
