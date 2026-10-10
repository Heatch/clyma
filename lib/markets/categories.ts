import type { MarketCategory } from "./types"

export const CATEGORY_LABELS: Record<MarketCategory, string> = {
  hurricane: "Hurricanes",
  drought: "Drought",
  temperature: "Temperature",
  rainfall: "Rainfall",
  flooding: "Flooding",
  "crop-yield": "Crops",
  wildfire: "Wildfire",
  other: "Other",
}

export const CATEGORY_ACCENTS: Record<MarketCategory, string> = {
  hurricane: "#a78bfa",
  drought: "#fbbf24",
  temperature: "#fb7185",
  rainfall: "#67e8f9",
  flooding: "#60a5fa",
  "crop-yield": "#a3e635",
  wildfire: "#fb923c",
  other: "#cbd5e1",
}

export const CATEGORY_SYMBOLS: Record<MarketCategory, string> = {
  hurricane: "cyclone",
  drought: "sun-crack",
  temperature: "thermometer",
  rainfall: "rain-cloud",
  flooding: "flooded-house",
  "crop-yield": "wheat",
  wildfire: "flame",
  other: "warning",
}

type CategorizedMarket = {
  id: string
  category: MarketCategory
}

/**
 * Distinct hazard categories present in a cluster, ordered by how many
 * markets each contributes. A selected market's category is always first so
 * the caller can render it on its own.
 */
export function resolveClusterCategories(
  markets: readonly CategorizedMarket[],
  selectedMarketId?: string | null,
): MarketCategory[] {
  const counts = new Map<MarketCategory, number>()
  for (const market of markets) {
    counts.set(market.category, (counts.get(market.category) ?? 0) + 1)
  }
  const ordered = [...counts.entries()]
    .sort((first, second) => second[1] - first[1])
    .map(([category]) => category)

  const selectedMarket = markets.find(
    (market) => market.id === selectedMarketId,
  )
  if (selectedMarket) {
    return [
      selectedMarket.category,
      ...ordered.filter((category) => category !== selectedMarket.category),
    ]
  }
  return ordered
}

export function resolveClusterHazardCategory(
  markets: readonly CategorizedMarket[],
  selectedMarketId?: string | null,
): MarketCategory | null {
  return resolveClusterCategories(markets, selectedMarketId)[0] ?? null
}
