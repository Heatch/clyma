import { describe, expect, it } from "vitest"

import {
  IDLE_ROTATION_MAX_ZOOM,
  shortestLongitudeDelta,
  shouldIdleRotate,
} from "@/components/globe/ClimateGlobe"

describe("shouldIdleRotate", () => {
  it("allows rotation when the drawer is closed and zoomed out", () => {
    expect(shouldIdleRotate({ drawerOpen: false, zoom: 1 })).toBe(true)
  })

  it("stops rotation while the drawer is open", () => {
    expect(shouldIdleRotate({ drawerOpen: true, zoom: 1 })).toBe(false)
  })

  it("stops rotation at or above half of the available zoom range", () => {
    expect(
      shouldIdleRotate({ drawerOpen: false, zoom: IDLE_ROTATION_MAX_ZOOM }),
    ).toBe(false)
    expect(
      shouldIdleRotate({
        drawerOpen: false,
        zoom: IDLE_ROTATION_MAX_ZOOM + 0.01,
      }),
    ).toBe(false)
    expect(
      shouldIdleRotate({
        drawerOpen: false,
        zoom: IDLE_ROTATION_MAX_ZOOM - 0.01,
      }),
    ).toBe(true)
  })
})

describe("shortestLongitudeDelta", () => {
  it("returns small deltas unchanged", () => {
    expect(shortestLongitudeDelta(10, 15)).toBeCloseTo(5, 10)
    expect(shortestLongitudeDelta(10, 5)).toBeCloseTo(-5, 10)
    expect(shortestLongitudeDelta(-30, -30)).toBeCloseTo(0, 10)
  })

  it("takes the short way across the antimeridian instead of a full spin", () => {
    // Exactly the same meridian: no motion, not a 360° spin.
    expect(shortestLongitudeDelta(181, -179)).toBeCloseTo(0, 10)
    expect(shortestLongitudeDelta(-179, 181)).toBeCloseTo(0, 10)
    // Near misses: ~2°/6° adjustments, not ~358°/354° spins.
    expect(shortestLongitudeDelta(179, -179)).toBeCloseTo(2, 10)
    expect(shortestLongitudeDelta(-179, 179)).toBeCloseTo(-2, 10)
    expect(shortestLongitudeDelta(175, -179)).toBeCloseTo(6, 10)
  })

  it("handles accumulated rotation beyond one full turn", () => {
    expect(shortestLongitudeDelta(540, -179)).toBeCloseTo(1, 10)
    expect(shortestLongitudeDelta(-541, 179)).toBeCloseTo(0, 10)
    expect(shortestLongitudeDelta(721, 1)).toBeCloseTo(0, 10)
  })

  it("never exceeds a half turn in magnitude", () => {
    const cases: Array<[number, number]> = [
      [0, 179.9],
      [0, -179.9],
      [123.4, -56.7],
      [-1000, 1000],
      [359.9, 0.1],
    ]
    for (const [from, to] of cases) {
      expect(Math.abs(shortestLongitudeDelta(from, to))).toBeLessThanOrEqual(
        180,
      )
    }
  })

  it("keeps the focused meridian identical (mod 360)", () => {
    const cases: Array<[number, number]> = [
      [181, -179],
      [-179, 181],
      [540, -179],
      [10, 15],
    ]
    for (const [from, to] of cases) {
      const landed = from + shortestLongitudeDelta(from, to)
      const normalize = (deg: number) => ((deg % 360) + 360) % 360
      expect(normalize(landed)).toBeCloseTo(normalize(to), 8)
    }
  })
})
