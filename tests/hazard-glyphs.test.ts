import { describe, expect, it } from "vitest"

import {
  HAZARD_GLYPH_SIZE_PX,
  hazardGlyphDelay,
  hazardGlyphMarkup,
  hazardGroupMarkup,
} from "@/components/globe/hazard-glyphs"
import { MARKET_CATEGORIES, type MarketCategory } from "@/lib/markets/types"

describe("hazard glyph markup", () => {
  it("covers every market category", () => {
    for (const category of MARKET_CATEGORIES) {
      expect(hazardGlyphMarkup(category)).toContain(
        `data-hazard-glyph="${category}"`,
      )
    }
  })

  it("renders a large, self-describing SVG per category", () => {
    expect(HAZARD_GLYPH_SIZE_PX).toBeGreaterThanOrEqual(32)
    for (const category of MARKET_CATEGORIES) {
      const markup = hazardGlyphMarkup(category)
      expect(markup).toContain("<svg")
      expect(markup).toContain('viewBox="0 0 32 32"')
      expect(markup).toContain('class="hg ')
      // Every glyph carries at least one animated part.
      expect(markup).toMatch(/class="hg-[a-z-]+/)
      expect(markup).toContain("aria-hidden")
    }
  })

  it("gives each category distinct art", () => {
    const markups = MARKET_CATEGORIES.map((category) =>
      hazardGlyphMarkup(category),
    )
    expect(new Set(markups).size).toBe(MARKET_CATEGORIES.length)
  })

  it("embeds no scripts or inline event handlers", () => {
    for (const category of MARKET_CATEGORIES) {
      const markup = hazardGlyphMarkup(category)
      expect(markup).not.toContain("<script")
      expect(markup).not.toMatch(/\son[a-z]+=/i)
    }
  })

  it("defines a self-evident animation per category", () => {
    const hooks: Record<MarketCategory, RegExp> = {
      hurricane: /hg-spin/,
      wildfire: /hg-flame/,
      "crop-yield": /hg-sway/,
      flooding: /hg-water/,
      temperature: /hg-mercury/,
      rainfall: /hg-drop/,
      drought: /hg-sun/,
      other: /hg-question/,
    }
    for (const category of MARKET_CATEGORIES) {
      expect(hazardGlyphMarkup(category)).toMatch(hooks[category])
    }
  })
})

describe("hazardGroupMarkup", () => {
  it("tiles one mini glyph per category for a mixed cluster", () => {
    const markup = hazardGroupMarkup(["hurricane", "flooding", "wildfire"])
    expect(markup).toContain('data-hazard-glyph="group"')
    expect(markup).toContain(
      'data-hazard-categories="hurricane,flooding,wildfire"',
    )
    // One transform tile per category.
    expect(markup.match(/translate\(/g)).toHaveLength(3)
    // The mini bodies keep their own animation hooks.
    expect(markup).toMatch(/hg-spin/)
    expect(markup).toMatch(/hg-water/)
    expect(markup).toMatch(/hg-flame/)
  })

  it("caps the group at three categories", () => {
    const markup = hazardGroupMarkup([
      "hurricane",
      "flooding",
      "wildfire",
      "drought",
    ])
    expect(markup.match(/translate\(/g)).toHaveLength(3)
    expect(markup).toContain(
      'data-hazard-categories="hurricane,flooding,wildfire"',
    )
  })

  it("falls back to a single glyph when only one category is present", () => {
    expect(hazardGroupMarkup(["wildfire"])).toBe(
      hazardGlyphMarkup("wildfire"),
    )
  })

  it("handles two categories side by side", () => {
    const markup = hazardGroupMarkup(["drought", "rainfall"])
    expect(markup.match(/translate\(/g)).toHaveLength(2)
    expect(markup).toContain('data-hazard-categories="drought,rainfall"')
  })

  it("embeds no scripts or inline event handlers", () => {
    const markup = hazardGroupMarkup(["hurricane", "flooding"])
    expect(markup).not.toContain("<script")
    expect(markup).not.toMatch(/\son[a-z]+=/i)
  })
})

describe("hazardGlyphDelay", () => {
  it("returns a negative seconds offset so glyph loops desync", () => {
    const delay = hazardGlyphDelay("market-1")
    expect(delay).toMatch(/^-\d+\.\d{3}s$/)
  })

  it("varies between markets and is deterministic", () => {
    const delays = new Set(
      ["a", "b", "c", "d", "e"].map((id) => hazardGlyphDelay(id)),
    )
    expect(delays.size).toBeGreaterThan(1)
    expect(hazardGlyphDelay("market-1")).toBe(hazardGlyphDelay("market-1"))
  })
})
