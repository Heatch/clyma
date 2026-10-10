import { describe, expect, it } from "vitest"

import {
  resolveClusterCategories,
  resolveClusterHazardCategory,
} from "@/lib/markets/categories"
import type { MarketCategory } from "@/lib/markets/types"

function market(id: string, category: MarketCategory) {
  return { id, category }
}

describe("resolveClusterCategories", () => {
  it("returns distinct categories ordered by market count", () => {
    const categories = resolveClusterCategories([
      market("a", "flooding"),
      market("b", "wildfire"),
      market("c", "flooding"),
      market("d", "wildfire"),
      market("e", "flooding"),
    ])
    expect(categories).toEqual(["flooding", "wildfire"])
  })

  it("returns a single entry for a uniform cluster", () => {
    expect(
      resolveClusterCategories([
        market("a", "drought"),
        market("b", "drought"),
      ]),
    ).toEqual(["drought"])
  })

  it("puts a selected market's category first without dropping others", () => {
    const categories = resolveClusterCategories(
      [
        market("a", "flooding"),
        market("b", "wildfire"),
        market("c", "flooding"),
      ],
      "b",
    )
    expect(categories).toEqual(["wildfire", "flooding"])
  })

  it("returns an empty list for an empty cluster", () => {
    expect(resolveClusterCategories([])).toEqual([])
  })
})

describe("resolveClusterHazardCategory", () => {
  it("reports the dominant category", () => {
    expect(
      resolveClusterHazardCategory([
        market("a", "flooding"),
        market("b", "wildfire"),
        market("c", "flooding"),
      ]),
    ).toBe("flooding")
  })

  it("returns null for an empty cluster", () => {
    expect(resolveClusterHazardCategory([])).toBeNull()
  })
})
