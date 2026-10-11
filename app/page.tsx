import Dashboard from "@/components/Dashboard"
import { initDb } from "@/lib/db/init"
import { queryMarkets } from "@/lib/db/repositories/markets"

export const dynamic = "force-dynamic"

export default async function HomePage() {
  await initDb()
  // The drawer browses the catalogue client-side, so the initial payload
  // must cover every market — a tight limit silently drops listings and
  // both headline counts (globe + drawer) under-report.
  const result = await queryMarkets({ limit: 1000 })

  return <Dashboard initialMarkets={result.markets} />
}
