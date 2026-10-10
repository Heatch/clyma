import { describe, expect, it } from "vitest"

import {
  CLUSTER_MIN_DISTANCE_PX,
  GLYPH_SIZE_PX,
  clusterProjectedPoints,
} from "@/lib/geo/clustering"

function point(id: string, x: number, y: number) {
  return { x, y, market: { id } }
}

describe("clusterProjectedPoints", () => {
  it("leaves comfortably-separated markers alone", () => {
    const clusters = clusterProjectedPoints([
      point("a", 0, 0),
      point("b", 100, 0),
      point("c", 0, 100),
    ])
    expect(clusters).toHaveLength(3)
    for (const cluster of clusters) {
      expect(cluster.markets).toHaveLength(1)
    }
  })

  it("merges only genuinely overlapping markers", () => {
    const clusters = clusterProjectedPoints([
      point("a", 0, 0),
      point("b", 8, 6), // 10px away: overlaps a 20px glyph
      point("c", 60, 0),
    ])
    expect(clusters).toHaveLength(2)
    const pair = clusters.find((cluster) => cluster.markets.length === 2)!
    expect(pair.markets.map((market) => market.id).sort()).toEqual(["a", "b"])
  })

  it("keeps the threshold honest at the boundary", () => {
    expect(CLUSTER_MIN_DISTANCE_PX).toBeGreaterThan(0)
    expect(CLUSTER_MIN_DISTANCE_PX).toBeLessThanOrEqual(GLYPH_SIZE_PX)
    const justInside = clusterProjectedPoints([
      point("a", 0, 0),
      point("b", CLUSTER_MIN_DISTANCE_PX - 0.5, 0),
    ])
    expect(justInside).toHaveLength(1)
    const justOutside = clusterProjectedPoints([
      point("a", 0, 0),
      point("b", CLUSTER_MIN_DISTANCE_PX + 0.5, 0),
    ])
    expect(justOutside).toHaveLength(2)
  })

  it("tracks the centroid and preserves exact membership", () => {
    const clusters = clusterProjectedPoints([
      point("a", 0, 0),
      point("b", 6, 0),
      point("c", 12, 0),
      point("d", 200, 200),
    ])
    expect(clusters).toHaveLength(2)
    const trio = clusters.find((cluster) => cluster.markets.length === 3)!
    expect(trio.markets.map((market) => market.id)).toEqual(["a", "b", "c"])
    expect(trio.x).toBeCloseTo(6, 8)
  })

  it("handles empty input", () => {
    expect(clusterProjectedPoints([])).toEqual([])
  })
})
