import Dashboard from "@/components/Dashboard"
import { getInitialClimateMarkets } from "@/lib/markets/gemini"

// Rendered per request so market generation (and its cache) runs on the server,
// never at build time and never exposing the Gemini key to the client.
export const dynamic = "force-dynamic"

export default async function HomePage() {
  const { markets } = await getInitialClimateMarkets()
  return <Dashboard initialMarkets={markets} />
}
