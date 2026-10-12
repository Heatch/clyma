import { CATEGORY_LABELS } from "@/lib/markets/categories"
import type { ClimateMarket } from "@/lib/markets/types"

function searchableFields(market: ClimateMarket): {
  primary: string[]
  secondary: string[]
} {
  const label = CATEGORY_LABELS[market.category] ?? ""
  return {
    primary: [
      market.question,
      market.region,
      market.country ?? "",
      market.continent,
      market.category,
      label,
    ],
    secondary: [market.description],
  }
}

function tokenize(query: string): { tokens: string[]; phrases: string[] } {
  const phrases: string[] = []
  const withoutPhrases = query.replace(/"([^"]+)"/g, (_, phrase: string) => {
    const trimmed = phrase.trim().toLocaleLowerCase()
    if (trimmed) phrases.push(trimmed)
    return " "
  })
  const tokens = withoutPhrases
    .toLocaleLowerCase()
    .split(/[^a-z0-9]+/)
    .map((token) => token.trim())
    .filter(Boolean)
  return { tokens, phrases }
}

/**
 * Token AND-matching across searchable fields. Every token must appear as a
 * substring of at least one field; tokens may match different fields. Quoted
 * phrases require the full literal substring in any field.
 */
export function matchesSearch(market: ClimateMarket, search: string): boolean {
  if (!search.trim()) return true
  const { tokens, phrases } = tokenize(search)
  if (tokens.length === 0 && phrases.length === 0) return true
  const { primary, secondary } = searchableFields(market)
  const all = [...primary, ...secondary].map((value) =>
    value.toLocaleLowerCase(),
  )
  return (
    tokens.every((token) => all.some((field) => field.includes(token))) &&
    phrases.every((phrase) => all.some((field) => field.includes(phrase)))
  )
}

/**
 * Relevance score for ordering when a query is active. Primary-field hits
 * (question/region/country/continent/category/label) outrank
 * description-only hits.
 */
export function searchRelevance(market: ClimateMarket, search: string): number {
  const { tokens, phrases } = tokenize(search)
  const terms = [...tokens, ...phrases]
  if (terms.length === 0) return 0
  const { primary, secondary } = searchableFields(market)
  const lowerPrimary = primary.map((value) => value.toLocaleLowerCase())
  const lowerSecondary = secondary.map((value) => value.toLocaleLowerCase())
  let score = 0
  for (const term of terms) {
    if (lowerPrimary.some((field) => field.includes(term))) score += 2
    else if (lowerSecondary.some((field) => field.includes(term))) score += 1
  }
  return score
}
