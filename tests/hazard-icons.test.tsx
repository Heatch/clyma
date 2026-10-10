import React from "react"
import { render } from "@testing-library/react"

import HazardIcon from "@/components/icons/HazardIcon"
import {
  CATEGORY_ACCENTS,
  CATEGORY_SYMBOLS,
  resolveClusterHazardCategory,
} from "@/lib/markets/categories"
import { MARKET_CATEGORIES } from "@/lib/markets/types"

describe("hazard icon system", () => {
  it("renders a distinct semantic symbol and accent for every category", () => {
    const { container } = render(
      <>
        {MARKET_CATEGORIES.map((category) => (
          <HazardIcon key={category} category={category} className="size-4" />
        ))}
      </>,
    )
    const icons = [...container.querySelectorAll("svg")]

    expect(icons).toHaveLength(MARKET_CATEGORIES.length)
    icons.forEach((icon, index) => {
      expect(icon).toHaveAttribute("data-hazard-icon", MARKET_CATEGORIES[index])
      expect(icon).toHaveAttribute(
        "data-hazard-symbol",
        CATEGORY_SYMBOLS[MARKET_CATEGORIES[index]!],
      )
      expect(icon).toHaveAttribute(
        "data-hazard-accent",
        CATEGORY_ACCENTS[MARKET_CATEGORIES[index]!],
      )
      expect(icon).toHaveAttribute("aria-hidden", "true")
      expect(icon).toHaveAttribute("focusable", "false")
      expect(icon).toHaveAttribute("stroke", "currentColor")
      expect(icon.style.getPropertyValue("--hazard-accent")).toBe(
        CATEGORY_ACCENTS[MARKET_CATEGORIES[index]!],
      )
      expect(icon.style.filter).toContain("drop-shadow")
    })
    expect(new Set(icons.map((icon) => icon.innerHTML)).size).toBe(
      MARKET_CATEGORIES.length,
    )
  })

  it("keeps category colors unique", () => {
    const accents = MARKET_CATEGORIES.map(
      (category) => CATEGORY_ACCENTS[category],
    )

    expect(Object.keys(CATEGORY_ACCENTS).sort()).toEqual(
      [...MARKET_CATEGORIES].sort(),
    )
    expect(accents.every((accent) => /^#[0-9a-f]{6}$/i.test(accent))).toBe(true)
    expect(new Set(accents).size).toBe(MARKET_CATEGORIES.length)
  })

  it("uses the dominant cluster symbol unless a market is selected", () => {
    const markets = [
      { id: "rain-1", category: "rainfall" as const },
      { id: "storm-1", category: "hurricane" as const },
      { id: "rain-2", category: "rainfall" as const },
    ]

    expect(resolveClusterHazardCategory(markets)).toBe("rainfall")
    expect(resolveClusterHazardCategory(markets, "storm-1")).toBe("hurricane")
    expect(resolveClusterHazardCategory([])).toBeNull()
  })
})
