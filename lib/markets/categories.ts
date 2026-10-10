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
