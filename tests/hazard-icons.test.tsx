import React from "react"
import { render } from "@testing-library/react"

import HazardIcon from "@/components/icons/HazardIcon"
import { MARKET_CATEGORIES } from "@/lib/markets/types"

describe("hazard icon system", () => {
  it("renders a distinct monochrome mark for every market category", () => {
    const { container } = render(
      <>
        {MARKET_CATEGORIES.map((category) => (
          <HazardIcon key={category} category={category} className="size-3" />
        ))}
      </>,
    )
    const icons = [...container.querySelectorAll("svg")]

    expect(icons).toHaveLength(MARKET_CATEGORIES.length)
    icons.forEach((icon, index) => {
      expect(icon).toHaveAttribute("data-hazard-icon", MARKET_CATEGORIES[index])
      expect(icon).toHaveAttribute("aria-hidden", "true")
      expect(icon).toHaveAttribute("focusable", "false")
      expect(icon).toHaveAttribute("stroke", "currentColor")
    })
    expect(new Set(icons.map((icon) => icon.innerHTML)).size).toBe(
      MARKET_CATEGORIES.length,
    )
  })
})
