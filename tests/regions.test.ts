import { describe, expect, it } from "vitest"

import { closestContinent } from "@/lib/geo/regions"

describe("closestContinent", () => {
  it("recognizes points on each continent", () => {
    expect(closestContinent(-98, 39)).toBe("North America")
    expect(closestContinent(-60, -10)).toBe("South America")
    expect(closestContinent(15, 50)).toBe("Europe")
    expect(closestContinent(20, 5)).toBe("Africa")
    expect(closestContinent(90, 35)).toBe("Asia")
    expect(closestContinent(135, -25)).toBe("Oceania")
  })

  it("leaves open ocean unselected", () => {
    expect(closestContinent(-30, 30)).toBeNull()
    expect(closestContinent(-150, 0)).toBeNull()
    expect(closestContinent(80, -30)).toBeNull()
  })
})
