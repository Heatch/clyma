"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import * as d3 from "d3"
import type { Feature, Geometry } from "geojson"
import { feature } from "topojson-client"
import type { GeometryObject, Objects, Topology } from "topojson-specification"
import landTopology from "world-atlas/land-110m.json"

import { useGlobeLink } from "@/components/providers/GlobeLinkProvider"
import {
  CLUSTER_MIN_DISTANCE_PX,
  clusterProjectedPoints,
  type PointCluster,
} from "@/lib/geo/clustering"
import {
  HAZARD_GLYPH_SIZE_PX,
  hazardGlyphDelay,
  hazardGlyphMarkup,
  hazardGroupMarkup,
} from "@/components/globe/hazard-glyphs"
import {
  CONTINENTS,
  REGION_CENTERS,
  closestContinent,
  isContinentName,
} from "@/lib/geo/regions"
import {
  CATEGORY_LABELS,
  resolveClusterCategories,
} from "@/lib/markets/categories"
import type { ClimateMarket } from "@/lib/markets/types"
import { clampProbability } from "@/lib/utils/likelihood"

type Projection = d3.GeoProjection

/** Screen hit radius for animated markers (~34px glyph, generous target). */
const MARKER_HIT_RADIUS_PX = 20

type PointerState = {
  x: number
  y: number
  startX: number
  startY: number
}

type ViewportTransition = {
  startedAt: number
  fromCenter: [number, number]
  toCenter: [number, number]
  fromBaseRadius: number
  toBaseRadius: number
}

/**
 * Shortest-path longitude delta in degrees, wrapped to [-180, 180).
 *
 * d3 rotation longitudes are periodic, but the focus animation lerps raw
 * values. Without wrapping, a globe sitting at rotation 181° focusing a
 * target at -179° (the same meridian) would spin ~360° instead of ~2°.
 */
export function shortestLongitudeDelta(
  fromLongitude: number,
  toLongitude: number,
): number {
  return ((((toLongitude - fromLongitude) % 360) + 540) % 360) - 180
}

interface ClimateGlobeProps {
  markets: ClimateMarket[]
  selectedRegion: string | null
  selectedMarketId?: string | null
  onRegionSelect: (region: string) => void
  onMarketSelect: (market: ClimateMarket) => void
  onClusterSelect: (markets: ClimateMarket[]) => void
  className?: string
  fullBleed?: boolean
}

const DEFAULT_ROTATION: [number, number, number] = [20, -12, 0]
const MIN_ZOOM = 0.68
const MAX_ZOOM = 2.35
const IDLE_DELAY_MS = 3200
const IDLE_ROTATION_DEGREES_PER_MS = 0.004
const TARGET_FRAME_INTERVAL_MS = 1000 / 30
const VIEWPORT_TRANSITION_MS = 520
const VIEWPORT_TRANSITION_MIN_DELTA_PX = 48

function makeLandFeature(): Feature<Geometry> {
  const topology = landTopology as unknown as Topology<
    Objects<Record<string, never>>
  >
  const geometry = topology.objects.land as GeometryObject<
    Record<string, never>
  >
  const converted = feature(topology, geometry)
  if (converted.type === "FeatureCollection") {
    return {
      type: "Feature",
      properties: {},
      geometry: {
        type: "GeometryCollection",
        geometries: converted.features.map((item) => item.geometry),
      },
    }
  }
  return converted as Feature<Geometry>
}

const LAND = makeLandFeature()
const GRATICULE = d3.geoGraticule10()

function createLandPattern(
  context: CanvasRenderingContext2D,
): CanvasPattern | null {
  if (typeof context.createPattern !== "function") return null
  const tile = document.createElement("canvas")
  tile.width = 7
  tile.height = 7
  const tileContext = tile.getContext("2d")
  if (!tileContext) return null
  tileContext.fillStyle = "rgba(226, 232, 240, 0.52)"
  tileContext.beginPath()
  tileContext.arc(1.6, 1.6, 0.85, 0, Math.PI * 2)
  tileContext.fill()
  return context.createPattern(tile, "repeat")
}

function isVisible(projection: Projection, coordinates: [number, number]) {
  const [rotateLongitude, rotateLatitude] = projection.rotate()
  return (
    d3.geoDistance([-rotateLongitude, -rotateLatitude], coordinates) <
    Math.PI / 2
  )
}

function easeInOut(value: number) {
  return value < 0.5
    ? 4 * value * value * value
    : 1 - Math.pow(-2 * value + 2, 3) / 2
}

function prefersReducedMotion() {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  )
}

export default function ClimateGlobe({
  markets,
  selectedRegion,
  selectedMarketId,
  onRegionSelect,
  onMarketSelect,
  onClusterSelect,
  className = "",
  fullBleed = false,
}: ClimateGlobeProps) {
  const { hoveredMarketIdRef } = useGlobeLink()
  const wrapperRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const projectionRef = useRef<Projection | null>(null)
  const rotationRef = useRef<[number, number, number]>([...DEFAULT_ROTATION])
  const baseRadiusRef = useRef(200)
  const zoomRef = useRef(1)
  const clustersRef = useRef<PointCluster<ClimateMarket>[]>([])
  const markersLayerRef = useRef<HTMLDivElement>(null)
  const hoveredCanvasMarketIdRef = useRef<string | null>(null)
  const renderVersionRef = useRef(0)
  const marketsRef = useRef(markets)
  const selectedRegionRef = useRef(selectedRegion)
  const selectedMarketIdRef = useRef(selectedMarketId)
  const idleUntilRef = useRef(0)
  const focusAnimationRef = useRef<{
    startedAt: number
    from: [number, number, number]
    to: [number, number, number]
  } | null>(null)
  const pointersRef = useRef(new Map<number, PointerState>())
  const pinchDistanceRef = useRef<number | null>(null)
  const draggedRef = useRef(false)
  const callbacksRef = useRef({ onRegionSelect, onMarketSelect, onClusterSelect })
  const [isReady, setIsReady] = useState(false)
  const [hoverLabel, setHoverLabel] = useState<string | null>(null)

  useEffect(() => {
    marketsRef.current = markets
    selectedRegionRef.current = selectedRegion
    selectedMarketIdRef.current = selectedMarketId
    callbacksRef.current = { onRegionSelect, onMarketSelect, onClusterSelect }
    renderVersionRef.current += 1
  }, [
    markets,
    onClusterSelect,
    onMarketSelect,
    onRegionSelect,
    selectedMarketId,
    selectedRegion,
  ])

  const marketCounts = useMemo(
    () =>
      new Map(
        CONTINENTS.map((continent) => [
          continent,
          markets.filter(
            (market) =>
              market.continent === continent && market.status === "open",
          ).length,
        ]),
      ),
    [markets],
  )

  const pauseRotation = useCallback(() => {
    idleUntilRef.current = performance.now() + IDLE_DELAY_MS
  }, [])

  const focusCoordinates = useCallback(
    (longitude: number, latitude: number) => {
      const destination: [number, number, number] = [-longitude, -latitude, 0]
      // Wrap the longitude leg to the shortest path: rotation accumulates
      // unboundedly via drag/idle spin, so the raw delta to the destination
      // can exceed a full turn even when the target is already centered.
      const wrappedDestination: [number, number, number] = [
        rotationRef.current[0] +
          shortestLongitudeDelta(rotationRef.current[0], destination[0]),
        destination[1],
        0,
      ]
      const now = performance.now()
      if (prefersReducedMotion()) {
        rotationRef.current = wrappedDestination
        focusAnimationRef.current = null
        idleUntilRef.current = now + IDLE_DELAY_MS
        return
      }
      focusAnimationRef.current = {
        startedAt: now,
        from: [...rotationRef.current],
        to: wrappedDestination,
      }
      idleUntilRef.current = now + IDLE_DELAY_MS + 900
    },
    [],
  )

  const focusRegion = useCallback(
    (region: string) => {
      if (!isContinentName(region)) return
      const [longitude, latitude] = REGION_CENTERS[region]
      focusCoordinates(longitude, latitude)
    },
    [focusCoordinates],
  )

  useEffect(() => {
    const selectedMarket = markets.find(
      (market) => market.id === selectedMarketId,
    )
    if (selectedMarket) {
      focusCoordinates(selectedMarket.longitude, selectedMarket.latitude)
      return
    }
    if (selectedRegion) focusRegion(selectedRegion)
  }, [focusCoordinates, focusRegion, markets, selectedMarketId, selectedRegion])

  useEffect(() => {
    const canvas = canvasRef.current
    const wrapper = wrapperRef.current
    if (!canvas || !wrapper) return

    const context = canvas.getContext("2d", {
      alpha: true,
      desynchronized: true,
    })
    if (!context) return

    const prefersReducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    )
    const projection = d3.geoOrthographic().clipAngle(90).precision(0.65)
    const path = d3.geoPath(projection, context)
    const landPattern = createLandPattern(context)
    projectionRef.current = projection
    // `width`/`height` are the canvas box; `viewWidth`/`viewHeight` are the
    // viewport box. During a size transition the canvas is held at the larger
    // of the two so the interpolating globe is never clipped by the canvas
    // edge, then finalised once the transition settles.
    let width = 0
    let height = 0
    let viewWidth = 0
    let viewHeight = 0
    let pixelRatio = 0
    let animationFrame = 0
    let lastFrame = performance.now()
    let lastTickAt = 0
    let lastRenderedVersion = -1
    let lastRenderedZoom = Number.NaN
    let lastRenderedRotation: [number, number, number] = [
      Number.NaN,
      Number.NaN,
      Number.NaN,
    ]
    let lastRenderedCanvasHover: string | null | undefined
    let lastRenderedLinkedHover: string | null | undefined
    let renderedBaseRadius = baseRadiusRef.current
    let viewportTransition: ViewportTransition | null = null

    const allocateCanvas = (
      nextWidth: number,
      nextHeight: number,
      ratio: number,
    ) => {
      if (
        nextWidth === width &&
        nextHeight === height &&
        Math.abs(ratio - pixelRatio) < 0.01
      ) {
        return
      }
      width = nextWidth
      height = nextHeight
      pixelRatio = ratio
      canvas.width = Math.round(width * pixelRatio)
      canvas.height = Math.round(height * pixelRatio)
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
      // The marker overlay must occupy exactly the canvas box so glyphs and
      // the globe always share one coordinate space.
      const layer = markersLayerRef.current
      if (layer) {
        layer.style.width = `${width}px`
        layer.style.height = `${height}px`
      }
    }

    const sampleViewportTransition = (now: number): boolean => {
      const transition = viewportTransition
      if (!transition) return false

      const progress = prefersReducedMotion.matches
        ? 1
        : Math.min(1, (now - transition.startedAt) / VIEWPORT_TRANSITION_MS)
      const eased = easeInOut(progress)
      renderedBaseRadius =
        transition.fromBaseRadius +
        (transition.toBaseRadius - transition.fromBaseRadius) * eased
      projection
        .translate([
          transition.fromCenter[0] +
            (transition.toCenter[0] - transition.fromCenter[0]) * eased,
          transition.fromCenter[1] +
            (transition.toCenter[1] - transition.fromCenter[1]) * eased,
        ])
        .scale(renderedBaseRadius * zoomRef.current)

      if (progress >= 1) {
        viewportTransition = null
        renderedBaseRadius = baseRadiusRef.current
        projection.translate([viewWidth / 2, viewHeight / 2])
        allocateCanvas(viewWidth, viewHeight, pixelRatio)
      }
      return true
    }

    const resize = () => {
      const rectangle = wrapper.getBoundingClientRect()
      const nextViewWidth = Math.max(280, rectangle.width)
      const nextViewHeight = Math.max(320, rectangle.height || 680)
      const nextPixelRatio = Math.min(
        window.devicePixelRatio || 1,
        nextViewWidth * nextViewHeight > 1_000_000 ? 1.25 : 1.5,
      )
      const sizeChanged =
        Math.abs(nextViewWidth - viewWidth) >= 0.5 ||
        Math.abs(nextViewHeight - viewHeight) >= 0.5
      const pixelRatioChanged = Math.abs(nextPixelRatio - pixelRatio) >= 0.01
      if (viewWidth > 0 && !sizeChanged && !pixelRatioChanged) return

      const hadPreviousViewport = viewWidth > 0 && viewHeight > 0
      const previousViewWidth = viewWidth
      const previousViewHeight = viewHeight
      const previousCenter = projection.translate() as [number, number]
      const previousBaseRadius = renderedBaseRadius
      const targetCenter: [number, number] = [
        nextViewWidth / 2,
        nextViewHeight / 2,
      ]
      const nextBaseRadius = Math.max(
        125,
        Math.min(nextViewWidth * 0.43, nextViewHeight * 0.42),
      )

      viewWidth = nextViewWidth
      viewHeight = nextViewHeight
      baseRadiusRef.current = nextBaseRadius

      const shouldAnimate =
        hadPreviousViewport &&
        sizeChanged &&
        !prefersReducedMotion.matches &&
        (viewportTransition !== null ||
          Math.abs(nextViewWidth - previousViewWidth) >=
            VIEWPORT_TRANSITION_MIN_DELTA_PX ||
          Math.abs(nextViewHeight - previousViewHeight) >=
            VIEWPORT_TRANSITION_MIN_DELTA_PX)

      if (shouldAnimate) {
        // Hold the canvas at the wider of the two viewports and let the
        // viewport's own overflow clip the excess, so the globe slides and
        // shrinks smoothly instead of being cut off by the canvas edge.
        allocateCanvas(
          Math.max(width, nextViewWidth),
          Math.max(height, nextViewHeight),
          nextPixelRatio,
        )
        viewportTransition = {
          startedAt: performance.now(),
          fromCenter: previousCenter,
          toCenter: targetCenter,
          fromBaseRadius: previousBaseRadius,
          toBaseRadius: nextBaseRadius,
        }
      } else {
        viewportTransition = null
        renderedBaseRadius = nextBaseRadius
        allocateCanvas(nextViewWidth, nextViewHeight, nextPixelRatio)
        projection.translate(targetCenter)
      }

      projection
        .rotate(rotationRef.current)
        .scale(renderedBaseRadius * zoomRef.current)
      renderVersionRef.current += 1
      draw()
    }

    // Offscreen cache for everything except the animated markers: the
    // background disc, graticule, region highlight and land only change
    // when the viewport does, so at rest each frame is a blit plus marker
    // strokes instead of a full re-render. Falls back to direct painting
    // when the buffer cannot be created.
    let staticLayer: HTMLCanvasElement | null = null
    let staticLayerContext: CanvasRenderingContext2D | null = null
    let staticLayerPath: typeof path | null = null
    let staticLayerPattern: CanvasPattern | null = null
    let staticLayerKey = ""
    let staticLayerWidth = 0
    let staticLayerHeight = 0

    const paintStaticLayers = (
      targetContext: CanvasRenderingContext2D,
      targetPath: typeof path,
      targetPattern: CanvasPattern | null,
      radius: number,
      center: [number, number],
      scaleFactor: number,
    ) => {
      targetContext.clearRect(0, 0, width, height)
      targetContext.save()
      targetContext.beginPath()
      targetContext.arc(center[0], center[1], radius, 0, Math.PI * 2)
      targetContext.fillStyle = "#070b0a"
      targetContext.fill()
      targetContext.strokeStyle = "rgba(255, 255, 255, 0.24)"
      targetContext.lineWidth = Math.max(0.75, 1.1 * scaleFactor)
      targetContext.stroke()
      targetContext.clip()

      targetContext.beginPath()
      targetPath(GRATICULE)
      targetContext.strokeStyle = "rgba(167, 243, 208, 0.07)"
      targetContext.lineWidth = Math.max(0.5, 0.65 * scaleFactor)
      targetContext.stroke()

      if (
        selectedRegionRef.current &&
        !selectedMarketIdRef.current &&
        isContinentName(selectedRegionRef.current)
      ) {
        const centerPoint = REGION_CENTERS[selectedRegionRef.current]
        const highlight = d3
          .geoCircle()
          .center([centerPoint[0], centerPoint[1]])
          .radius(17)()
        targetContext.beginPath()
        targetPath(highlight)
        targetContext.fillStyle = "rgba(255, 255, 255, 0.08)"
        targetContext.fill()
        targetContext.strokeStyle = "rgba(255, 255, 255, 0.5)"
        targetContext.lineWidth = 1
        targetContext.stroke()
      }

      targetContext.beginPath()
      targetPath(LAND)
      targetContext.fillStyle = targetPattern ?? "rgba(226, 232, 240, 0.42)"
      targetContext.fill()
      targetContext.strokeStyle = "rgba(255, 255, 255, 0.34)"
      targetContext.lineWidth = Math.max(0.45, 0.72 * scaleFactor)
      targetContext.stroke()
      targetContext.restore()
    }

    // Markers render as a DOM overlay above the canvas: crisp, CSS-animated
    // SVG glyphs that cost nothing per frame. The canvas stays the source of
    // truth for positions and hit-testing; this reconciles one node per
    // visible cluster, keyed by its member ids so nodes are reused as the
    // globe turns.
    const markerNodes = new Map<
      string,
      { el: HTMLDivElement; glyphId: string }
    >()

    const syncMarkers = (clusters: PointCluster<ClimateMarket>[]) => {
      const layer = markersLayerRef.current
      if (!layer) return
      const seen = new Set<string>()
      for (const cluster of clusters) {
        const selectedMarket = cluster.markets.find(
          (market) => market.id === selectedMarketIdRef.current,
        )
        // A selected market always shows its own hazard; otherwise a cluster
        // that mixes hazard types shows a grouped glyph instead of picking
        // one type and implying the whole count is that type.
        const shown = selectedMarket
          ? [selectedMarket.category]
          : resolveClusterCategories(cluster.markets)
        const selected = Boolean(selectedMarket)
        if (shown.length === 0) continue
        const mixed = shown.length > 1
        const glyphId = mixed ? `group:${shown.join("|")}` : `cat:${shown[0]}`
        const key = cluster.markets
          .map((market) => market.id)
          .sort()
          .join("|")
        seen.add(key)
        let node = markerNodes.get(key)
        if (!node || node.glyphId !== glyphId) {
          node?.el.remove()
          const el = document.createElement("div")
          el.className = "globe-marker"
          el.dataset.clusterKey = key
          el.style.setProperty("--glyph-size", `${HAZARD_GLYPH_SIZE_PX}px`)
          el.innerHTML = mixed
            ? hazardGroupMarkup(shown)
            : hazardGlyphMarkup(shown[0]!)
          const count = document.createElement("span")
          count.className = "globe-marker__count"
          el.appendChild(count)
          node = { el, glyphId }
          markerNodes.set(key, node)
          layer.appendChild(el)
        }
        const hovered = cluster.markets.some(
          (market) =>
            market.id === hoveredMarketIdRef.current ||
            market.id === hoveredCanvasMarketIdRef.current,
        )
        const scale = selected ? 1.22 : hovered ? 1.1 : 1
        node.el.style.transform = `translate3d(${cluster.x}px, ${cluster.y}px, 0) scale(${scale})`
        node.el.style.setProperty(
          "--hg-delay",
          hazardGlyphDelay(cluster.markets[0]!.id),
        )
        node.el.classList.toggle("is-selected", selected)
        node.el.classList.toggle("is-hovered", hovered)
        const count = node.el.lastElementChild as HTMLSpanElement | null
        if (count) {
          count.textContent =
            cluster.markets.length > 1 ? String(cluster.markets.length) : ""
        }
        node.el.dataset.marketCount = String(cluster.markets.length)
      }
      for (const [key, node] of markerNodes) {
        if (!seen.has(key)) {
          node.el.remove()
          markerNodes.delete(key)
        }
      }
    }

    const draw = () => {
      const radius = projection.scale()
      const center = projection.translate()
      const scaleFactor = radius / Math.max(1, renderedBaseRadius)
      const rotation = rotationRef.current
      const staticKey = [
        width,
        height,
        pixelRatio,
        renderedBaseRadius,
        center[0],
        center[1],
        rotation[0],
        rotation[1],
        rotation[2],
        zoomRef.current,
        renderVersionRef.current,
        selectedRegionRef.current,
        selectedMarketIdRef.current,
      ].join("|")

      const backingWidth = Math.max(1, Math.round(width * pixelRatio))
      const backingHeight = Math.max(1, Math.round(height * pixelRatio))
      if (
        !staticLayer ||
        staticLayerWidth !== backingWidth ||
        staticLayerHeight !== backingHeight
      ) {
        try {
          const layer = document.createElement("canvas")
          layer.width = backingWidth
          layer.height = backingHeight
          const layerContext = layer.getContext("2d")
          staticLayer = layer
          staticLayerContext = layerContext
          staticLayerPath = layerContext
            ? d3.geoPath(projection, layerContext)
            : null
          staticLayerPattern = layerContext
            ? createLandPattern(layerContext)
            : null
          staticLayerWidth = backingWidth
          staticLayerHeight = backingHeight
          staticLayerKey = ""
        } catch {
          staticLayer = null
          staticLayerContext = null
          staticLayerPath = null
        }
      }

      if (staticLayer && staticLayerContext && staticLayerPath) {
        if (staticLayerKey !== staticKey) {
          staticLayerContext.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
          paintStaticLayers(
            staticLayerContext,
            staticLayerPath,
            staticLayerPattern,
            radius,
            center,
            scaleFactor,
          )
          staticLayerKey = staticKey
        }
        context.clearRect(0, 0, width, height)
        context.drawImage(staticLayer, 0, 0, width, height)
      } else {
        paintStaticLayers(context, path, landPattern, radius, center, scaleFactor)
      }

      // Project and cluster visible open markets. The result drives both the
      // DOM marker overlay and canvas hit-testing.
      const projectedMarkets = marketsRef.current
        .filter((market) => market.status === "open")
        .flatMap((market) => {
          const coordinates: [number, number] = [
            market.longitude,
            market.latitude,
          ]
          if (!isVisible(projection, coordinates)) return []
          const point = projection(coordinates)
          return point ? [{ market, x: point[0], y: point[1] }] : []
        })

      const clusters = clusterProjectedPoints(
        projectedMarkets,
        CLUSTER_MIN_DISTANCE_PX,
      )
      clustersRef.current = clusters
      syncMarkers(clusters)
    }

    const tick = (now: number) => {
      const frameElapsed = now - lastTickAt
      if (document.hidden || frameElapsed < TARGET_FRAME_INTERVAL_MS) {
        animationFrame = window.requestAnimationFrame(tick)
        return
      }
      lastTickAt = now - (frameElapsed % TARGET_FRAME_INTERVAL_MS)
      const elapsed = Math.min(50, now - lastFrame)
      lastFrame = now
      const focusAnimation = focusAnimationRef.current
      if (focusAnimation) {
        const progress = Math.min(1, (now - focusAnimation.startedAt) / 800)
        const eased = easeInOut(progress)
        rotationRef.current = [
          focusAnimation.from[0] +
            (focusAnimation.to[0] - focusAnimation.from[0]) * eased,
          focusAnimation.from[1] +
            (focusAnimation.to[1] - focusAnimation.from[1]) * eased,
          0,
        ]
        if (progress >= 1) focusAnimationRef.current = null
      } else if (
        !prefersReducedMotion.matches &&
        pointersRef.current.size === 0 &&
        now > idleUntilRef.current
      ) {
        rotationRef.current[0] =
          (rotationRef.current[0] + elapsed * IDLE_ROTATION_DEGREES_PER_MS) %
          360
      }

      const isViewportAnimating = sampleViewportTransition(now)
      if (!isViewportAnimating) {
        renderedBaseRadius = baseRadiusRef.current
        projection.translate([viewWidth / 2, viewHeight / 2])
      }
      projection
        .rotate(rotationRef.current)
        .scale(renderedBaseRadius * zoomRef.current)

      const rotation = rotationRef.current
      const linkedHover = hoveredMarketIdRef.current
      const canvasHover = hoveredCanvasMarketIdRef.current
      // Glyph motion is CSS-driven, so the canvas only redraws when the
      // viewport or hover/selection state actually changes.
      const shouldDraw =
        renderVersionRef.current !== lastRenderedVersion ||
        zoomRef.current !== lastRenderedZoom ||
        rotation[0] !== lastRenderedRotation[0] ||
        rotation[1] !== lastRenderedRotation[1] ||
        rotation[2] !== lastRenderedRotation[2] ||
        canvasHover !== lastRenderedCanvasHover ||
        linkedHover !== lastRenderedLinkedHover ||
        isViewportAnimating

      if (shouldDraw) {
        draw()
        lastRenderedVersion = renderVersionRef.current
        lastRenderedZoom = zoomRef.current
        lastRenderedRotation = [...rotation]
        lastRenderedCanvasHover = canvasHover
        lastRenderedLinkedHover = linkedHover
      }
      animationFrame = window.requestAnimationFrame(tick)
    }

    const resizeObserver = new ResizeObserver(resize)
    resizeObserver.observe(wrapper)
    resize()
    setIsReady(true)
    animationFrame = window.requestAnimationFrame(tick)

    return () => {
      resizeObserver.disconnect()
      window.cancelAnimationFrame(animationFrame)
      markerNodes.forEach((node) => node.el.remove())
      markerNodes.clear()
      projectionRef.current = null
    }
    // hoveredMarketIdRef is a stable ref; listed to satisfy exhaustive-deps.
  }, [hoveredMarketIdRef])

  const findTarget = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current
    const projection = projectionRef.current
    if (!canvas || !projection) return null
    const rectangle = canvas.getBoundingClientRect()
    const x = clientX - rectangle.left
    const y = clientY - rectangle.top
    const cluster = clustersRef.current.find(
      (item) => Math.hypot(item.x - x, item.y - y) <= MARKER_HIT_RADIUS_PX,
    )
    if (cluster) return { type: "cluster" as const, cluster }
    const coordinates = projection.invert?.([x, y])
    if (!coordinates) return null
    const region = closestContinent(coordinates[0], coordinates[1])
    return region ? { type: "region" as const, region } : null
  }, [])

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId)
    pointersRef.current.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
      startX: event.clientX,
      startY: event.clientY,
    })
    draggedRef.current = false
    pauseRotation()
    if (pointersRef.current.size === 2) {
      const pointers = [...pointersRef.current.values()]
      const first = pointers[0]
      const second = pointers[1]
      if (first && second)
        pinchDistanceRef.current = Math.hypot(
          first.x - second.x,
          first.y - second.y,
        )
    }
  }

  const prefetchedRegionsRef = useRef<Set<string>>(new Set())

  const prefetchRegionModel = useCallback((regionName: string) => {
    if (prefetchedRegionsRef.current.has(regionName)) return
    prefetchedRegionsRef.current.add(regionName)

    const targetMarket = marketsRef.current.find(
      (m) => m.continent === regionName || m.region === regionName
    )
    if (!targetMarket) return

    fetch("/api/predict", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        question: targetMarket.question,
        resolution_rules: targetMarket.resolutionRules,
      }),
    }).catch(() => {})
  }, [])

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const pointer = pointersRef.current.get(event.pointerId)
    if (!pointer) {
      const target = findTarget(event.clientX, event.clientY)
      if (target?.type === "cluster") {
        const singleMarket = target.cluster.markets[0]
        if (singleMarket) {
          prefetchRegionModel(singleMarket.continent)
        }
        hoveredCanvasMarketIdRef.current = singleMarket?.id ?? null
        setHoverLabel(
          target.cluster.markets.length > 1
            ? `${target.cluster.markets.length} overlapping markets · click to list`
            : singleMarket
              ? `${CATEGORY_LABELS[singleMarket.category]} · ${singleMarket.region} · YES ${Math.round(
                  clampProbability(singleMarket.yesPrice) * 100,
                )}%`
              : null,
        )
      } else if (target?.type === "region") {
        hoveredCanvasMarketIdRef.current = null
        setHoverLabel(`${target.region} · select region`)
        prefetchRegionModel(target.region)
      } else {
        hoveredCanvasMarketIdRef.current = null
        setHoverLabel(null)
      }
      return
    }

    const previousX = pointer.x
    const previousY = pointer.y
    pointer.x = event.clientX
    pointer.y = event.clientY
    if (Math.hypot(pointer.x - pointer.startX, pointer.y - pointer.startY) > 5)
      draggedRef.current = true

    const pointers = [...pointersRef.current.values()]
    if (pointers.length >= 2) {
      const first = pointers[0]
      const second = pointers[1]
      if (!first || !second) return
      const nextDistance = Math.hypot(first.x - second.x, first.y - second.y)
      if (pinchDistanceRef.current) {
        zoomRef.current = Math.max(
          MIN_ZOOM,
          Math.min(
            MAX_ZOOM,
            zoomRef.current * (nextDistance / pinchDistanceRef.current),
          ),
        )
      }
      pinchDistanceRef.current = nextDistance
      return
    }

    const sensitivity = 0.28 / Math.max(0.75, zoomRef.current)
    rotationRef.current = [
      rotationRef.current[0] + (event.clientX - previousX) * sensitivity,
      Math.max(
        -82,
        Math.min(
          82,
          rotationRef.current[1] - (event.clientY - previousY) * sensitivity,
        ),
      ),
      0,
    ]
    focusAnimationRef.current = null
  }

  const handlePointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const wasDragging = draggedRef.current
    pointersRef.current.delete(event.pointerId)
    if (pointersRef.current.size < 2) pinchDistanceRef.current = null
    pauseRotation()
    if (wasDragging) return

    const target = findTarget(event.clientX, event.clientY)
    if (target?.type === "cluster") {
      const market = target.cluster.markets[0]
      if (!market) return
      if (target.cluster.markets.length === 1)
        callbacksRef.current.onMarketSelect(market)
      else callbacksRef.current.onClusterSelect(target.cluster.markets)
      return
    }
    if (target?.type === "region")
      callbacksRef.current.onRegionSelect(target.region)
  }

  const handleWheel = (event: React.WheelEvent<HTMLCanvasElement>) => {
    event.preventDefault()
    const zoomMultiplier = Math.exp(-event.deltaY * 0.001)
    zoomRef.current = Math.max(
      MIN_ZOOM,
      Math.min(MAX_ZOOM, zoomRef.current * zoomMultiplier),
    )
    pauseRotation()
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLCanvasElement>) => {
    const rotationStep = event.shiftKey ? 15 : 6
    if (
      [
        "ArrowLeft",
        "ArrowRight",
        "ArrowUp",
        "ArrowDown",
        "+",
        "=",
        "-",
        "0",
      ].includes(event.key)
    ) {
      event.preventDefault()
    }
    if (event.key === "ArrowLeft") rotationRef.current[0] -= rotationStep
    if (event.key === "ArrowRight") rotationRef.current[0] += rotationStep
    if (event.key === "ArrowUp")
      rotationRef.current[1] = Math.min(
        82,
        rotationRef.current[1] + rotationStep,
      )
    if (event.key === "ArrowDown")
      rotationRef.current[1] = Math.max(
        -82,
        rotationRef.current[1] - rotationStep,
      )
    if (event.key === "+" || event.key === "=")
      zoomRef.current = Math.min(MAX_ZOOM, zoomRef.current * 1.12)
    if (event.key === "-")
      zoomRef.current = Math.max(MIN_ZOOM, zoomRef.current / 1.12)
    if (event.key === "0") {
      rotationRef.current = [...DEFAULT_ROTATION]
      zoomRef.current = 1
    }
    focusAnimationRef.current = null
    pauseRotation()
  }

  const resetView = () => {
    if (prefersReducedMotion()) {
      rotationRef.current = [...DEFAULT_ROTATION]
      focusAnimationRef.current = null
      zoomRef.current = 1
      pauseRotation()
      return
    }
    focusAnimationRef.current = {
      startedAt: performance.now(),
      from: [...rotationRef.current],
      to: [...DEFAULT_ROTATION],
    }
    zoomRef.current = 1
    pauseRotation()
  }

  return (
    <section
      className={`relative flex flex-col overflow-hidden bg-transparent text-white ${
        fullBleed
          ? "h-full min-h-0"
          : "min-h-[430px] rounded-[1.75rem] border border-neutral-800 bg-[#070b0a] shadow-panel"
      } ${className}`}
      aria-labelledby="globe-heading"
    >
      <h2 id="globe-heading" className="sr-only">
        Interactive global climate market map
      </h2>

      <div ref={wrapperRef} className="relative min-h-0 flex-1 touch-none">
        {!isReady && (
          <div
            className="absolute inset-0 z-10 grid place-items-center"
            role="status"
          >
            <span className="soft-pulse text-xs font-semibold uppercase tracking-[0.18em] text-neutral-400">
              Plotting markets
            </span>
          </div>
        )}
        <canvas
          ref={canvasRef}
          className="block h-full w-full cursor-grab touch-none active:cursor-grabbing"
          aria-label="Interactive halftone globe with climate market markers. Drag or use arrow keys to rotate, scroll or use plus and minus keys to zoom."
          role="img"
          tabIndex={0}
          onKeyDown={handleKeyDown}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerLeave={() => {
            hoveredCanvasMarketIdRef.current = null
            setHoverLabel(null)
          }}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onWheel={handleWheel}
        />
        <div
          ref={markersLayerRef}
          className="pointer-events-none absolute left-0 top-0 z-[5] overflow-hidden"
          aria-hidden="true"
        />
        {hoverLabel && (
          <div className="pointer-events-none absolute bottom-28 left-1/2 z-20 max-w-[82%] -translate-x-1/2 rounded-full border border-white/15 bg-black/85 px-3 py-1.5 text-center font-mono text-[9px] uppercase tracking-[0.08em] text-white/80 backdrop-blur-xl">
            {hoverLabel}
          </div>
        )}
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-30 flex justify-center px-3">
        <div className="pointer-events-auto flex w-full max-w-[430px] items-center gap-1.5 rounded-2xl border border-white/15 bg-black/75 p-1.5 shadow-[0_20px_60px_rgba(0,0,0,0.4)] backdrop-blur-xl sm:rounded-full">
          <label htmlFor="globe-region" className="sr-only">
            Explore markets by region
          </label>
          <select
            id="globe-region"
            aria-label="Explore markets by region"
            value={selectedRegion ?? ""}
            onChange={(event) => {
              if (!event.target.value) return
              callbacksRef.current.onRegionSelect(event.target.value)
              focusRegion(event.target.value)
            }}
            className="min-w-0 flex-1 rounded-xl border border-transparent bg-white/[0.07] px-3 py-2.5 font-mono text-[10px] uppercase tracking-[0.08em] text-white outline-none transition-[border-color,background-color] hover:bg-white/10 focus:border-white/35 focus-visible:ring-2 focus-visible:ring-white sm:rounded-full"
          >
            <option value="" className="text-black">
              Jump to region
            </option>
            {CONTINENTS.map((continent) => (
              <option key={continent} value={continent} className="text-black">
                {continent} · {marketCounts.get(continent) ?? 0} active
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={resetView}
            className="shrink-0 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5 font-mono text-[9px] uppercase tracking-[0.08em] text-white/60 transition hover:border-white/25 hover:bg-white/10 hover:text-white sm:rounded-full"
            aria-label="Reset globe view and zoom"
          >
            Reset
          </button>
        </div>
      </div>
    </section>
  )
}
