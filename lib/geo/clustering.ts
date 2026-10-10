/**
 * Screen-space clustering for globe markers.
 *
 * A cluster forms only when markers would genuinely overlap on screen —
 * i.e. their centers are closer than one drawn-glyph diameter.
 * Comfortably-separated markers always render individually with no count
 * badge. Pure functions; the projection-dependent part (turning lat/lon into
 * x/y) stays in the globe component.
 */

/** Diameter of a rendered hazard glyph, in CSS pixels. */
export const GLYPH_SIZE_PX = 34

/** Centers closer than one glyph diameter merge, so two individually-drawn
 *  glyphs can never significantly overlap — the count only appears when the
 *  markets genuinely pile up on the same spot. */
export const CLUSTER_MIN_DISTANCE_PX = GLYPH_SIZE_PX

export interface ProjectedPoint<T> {
  x: number
  y: number
  market: T
}

export interface PointCluster<T> {
  x: number
  y: number
  markets: T[]
}

/**
 * Greedy centroid clustering: each point joins the first cluster whose
 * centroid is within `minDistance`, otherwise it starts its own cluster.
 * Centroids are running means, so membership is insertion-order dependent —
 * the caller must feed points in a stable order.
 */
export function clusterProjectedPoints<T extends { id: string }>(
  points: ReadonlyArray<ProjectedPoint<T>>,
  minDistance: number = CLUSTER_MIN_DISTANCE_PX,
): PointCluster<T>[] {
  const clusters: PointCluster<T>[] = []
  for (const point of points) {
    const nearby = clusters.find(
      (cluster) =>
        Math.hypot(cluster.x - point.x, cluster.y - point.y) < minDistance,
    )
    if (nearby) {
      const count = nearby.markets.length
      nearby.x = (nearby.x * count + point.x) / (count + 1)
      nearby.y = (nearby.y * count + point.y) / (count + 1)
      nearby.markets.push(point.market)
    } else {
      clusters.push({ x: point.x, y: point.y, markets: [point.market] })
    }
  }
  return clusters
}
