import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const logoFiles = ["public/clyma-logo-shadow.svg", "app/icon.svg"]

describe("brand assets", () => {
  it("keeps the full tree visible in every logo", () => {
    for (const file of logoFiles) {
      const markup = readFileSync(join(process.cwd(), file), "utf-8")
      expect(markup).toContain('viewBox="0 0 400 380"')

      const rectangles = markup.match(/<rect[^>]*>/g) ?? []
      expect(rectangles.length).toBeGreaterThan(0)
      for (const rectangle of rectangles) {
        expect(rectangle).toMatch(/width="\d+(\.\d+)?"/)
        expect(rectangle).toMatch(/height="\d+(\.\d+)?"/)
      }
    }
  })
})
