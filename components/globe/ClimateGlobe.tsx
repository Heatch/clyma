"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import * as d3 from "d3"
import type { Feature, Geometry } from "geojson"
import { feature } from "topojson-client"
import type { GeometryObject, Objects, Topology } from "topojson-specification"
import landTopology from "world-atlas/land-110m.json"

import { useGlobeLink } from "@/components/providers/GlobeLinkProvider"
import {
  CONTINENTS,
  REGION_CENTERS,
  closestContinent,
  isContinentName,
} from "@/lib/geo/regions"
import { CATEGORY_LABELS } from "@/lib/markets/categories"
import type { ClimateMarket, MarketCategory } from "@/lib/markets/types"
import { clampProbability } from "@/lib/utils/likelihood"

type Projection = d3.GeoProjection

type RenderedCluster = {
  x: number
  y: number
  markets: ClimateMarket[]
}

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

interface ClimateGlobeProps {
  markets: ClimateMarket[]
  selectedRegion: string | null
  selectedMarketId?: string | null
  onRegionSelect: (region: string) => void
  onMarketSelect: (market: ClimateMarket) => void
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

function drawHazardGlyph(
  context: CanvasRenderingContext2D,
  category: MarketCategory,
  x: number,
  y: number,
  color: string,
) {
  context.save()
  context.translate(x, y)
  context.scale(1.35, 1.35)
  context.translate(-x, -y)
  context.strokeStyle = color
  context.fillStyle = color
  context.lineWidth = 1.25
  context.lineCap = "round"
  context.lineJoin = "round"

  switch (category) {
    case "hurricane":
      context.beginPath()
      context.arc(x - 1.1, y - 0.5, 2.8, Math.PI * 0.15, Math.PI * 1.15)
      context.stroke()
      context.beginPath()
      context.arc(x + 1.1, y + 0.5, 2.8, Math.PI * 1.15, Math.PI * 2.15)
      context.stroke()
      context.beginPath()
      context.arc(x, y, 0.65, 0, Math.PI * 2)
      context.fill()
      break
    case "drought":
      context.beginPath()
      context.moveTo(x - 3.8, y - 1.2)
      context.lineTo(x + 3.8, y - 1.2)
      context.moveTo(x - 1.5, y - 1.2)
      context.lineTo(x, y + 0.5)
      context.lineTo(x - 1, y + 2)
      context.lineTo(x + 0.8, y + 3.6)
      context.moveTo(x, y + 0.5)
      context.lineTo(x + 2, y + 1.4)
      context.stroke()
      context.beginPath()
      context.arc(x + 2.4, y - 3.2, 1.1, 0, Math.PI * 2)
      context.stroke()
      break
    case "temperature":
      context.beginPath()
      context.moveTo(x, y - 3.8)
      context.lineTo(x, y + 1.6)
      context.moveTo(x + 1.6, y - 2.4)
      context.lineTo(x + 3, y - 2.4)
      context.stroke()
      context.beginPath()
      context.arc(x, y + 2.7, 1.55, 0, Math.PI * 2)
      context.fill()
      break
    case "rainfall":
      context.beginPath()
      context.arc(x - 1.3, y - 0.8, 1.8, Math.PI, Math.PI * 2)
      context.arc(x + 1.2, y - 1.2, 2.2, Math.PI, Math.PI * 2)
      context.moveTo(x - 3.1, y - 0.7)
      context.lineTo(x + 3.4, y - 0.7)
      context.moveTo(x - 1.7, y + 1.1)
      context.lineTo(x - 1.7, y + 3.4)
      context.moveTo(x + 1.6, y + 1.1)
      context.lineTo(x + 1.6, y + 3.4)
      context.stroke()
      break
    case "flooding":
      context.beginPath()
      context.moveTo(x - 2.8, y - 1.4)
      context.lineTo(x, y - 3.7)
      context.lineTo(x + 2.8, y - 1.4)
      context.moveTo(x - 1.8, y - 1.4)
      context.lineTo(x - 1.8, y + 0.2)
      context.moveTo(x - 3.8, y + 1.2)
      context.lineTo(x - 2.4, y + 0.5)
      context.lineTo(x - 1, y + 1.2)
      context.lineTo(x + 0.4, y + 0.5)
      context.lineTo(x + 1.8, y + 1.2)
      context.lineTo(x + 3.2, y + 0.5)
      context.moveTo(x - 3.8, y + 3.2)
      context.lineTo(x - 2.4, y + 2.5)
      context.lineTo(x - 1, y + 3.2)
      context.lineTo(x + 0.4, y + 2.5)
      context.lineTo(x + 1.8, y + 3.2)
      context.lineTo(x + 3.2, y + 2.5)
      context.stroke()
      break
    case "crop-yield":
      context.beginPath()
      context.moveTo(x, y - 3.8)
      context.lineTo(x, y + 3.8)
      context.moveTo(x, y - 1.8)
      context.lineTo(x - 2.5, y - 3)
      context.moveTo(x, y - 0.2)
      context.lineTo(x + 2.5, y - 1.5)
      context.moveTo(x, y + 1.4)
      context.lineTo(x - 2.5, y + 0.2)
      context.moveTo(x, y + 2.8)
      context.lineTo(x + 2.3, y + 1.7)
      context.stroke()
      break
    case "wildfire":
      context.beginPath()
      context.moveTo(x + 0.4, y - 4)
      context.lineTo(x + 2.8, y - 1)
      context.lineTo(x + 2.1, y + 2.5)
      context.lineTo(x, y + 4)
      context.lineTo(x - 2.5, y + 2.2)
      context.lineTo(x - 2.9, y - 0.5)
      context.lineTo(x - 1.1, y - 3)
      context.lineTo(x - 0.9, y + 0.8)
      context.lineTo(x + 0.7, y - 1)
      context.closePath()
      context.stroke()
      context.beginPath()
      context.moveTo(x - 0.6, y + 2)
      context.lineTo(x, y + 0.2)
      context.lineTo(x + 0.8, y + 1.7)
      context.stroke()
      break
    case "other":
      context.beginPath()
      context.moveTo(x, y - 3.8)
      context.lineTo(x + 3.7, y + 3.1)
      context.lineTo(x - 3.7, y + 3.1)
      context.closePath()
      context.stroke()
      context.beginPath()
      context.moveTo(x, y - 1.4)
      context.lineTo(x, y + 0.8)
      context.stroke()
      context.beginPath()
      context.arc(x, y + 2, 0.55, 0, Math.PI * 2)
      context.fill()
      break
  }

  context.restore()
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
  const clustersRef = useRef<RenderedCluster[]>([])
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
  const callbacksRef = useRef({ onRegionSelect, onMarketSelect })
  const [isReady, setIsReady] = useState(false)
  const [hoverLabel, setHoverLabel] = useState<string | null>(null)

  useEffect(() => {
    marketsRef.current = markets
    selectedRegionRef.current = selectedRegion
    selectedMarketIdRef.current = selectedMarketId
    callbacksRef.current = { onRegionSelect, onMarketSelect }
    renderVersionRef.current += 1
  }, [
    markets,
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
      const now = performance.now()
      if (prefersReducedMotion()) {
        rotationRef.current = destination
        focusAnimationRef.current = null
        idleUntilRef.current = now + IDLE_DELAY_MS
        return
      }
      focusAnimationRef.current = {
        startedAt: now,
        from: [...rotationRef.current],
        to: destination,
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
    let width = 0
    let height = 0
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
      if (progress >= 1) viewportTransition = null
      return true
    }

    const resize = () => {
      const now = performance.now()
      const hadActiveTransition = viewportTransition !== null
      sampleViewportTransition(now)

      const rectangle = wrapper.getBoundingClientRect()
      const nextWidth = Math.max(280, rectangle.width)
      const nextHeight = Math.max(320, rectangle.height || 680)
      const nextBaseRadius = Math.max(
        125,
        Math.min(nextWidth * 0.43, nextHeight * 0.42),
      )
      const targetCenter: [number, number] = [nextWidth / 2, nextHeight / 2]
      const hasPreviousViewport = width > 0 && height > 0
      const widthDelta = Math.abs(nextWidth - width)
      const heightDelta = Math.abs(nextHeight - height)
      const nextPixelRatio = Math.min(
        window.devicePixelRatio || 1,
        nextWidth * nextHeight > 1_000_000 ? 1.25 : 1.5,
      )
      const logicalSizeChanged = widthDelta >= 0.5 || heightDelta >= 0.5
      const pixelRatioChanged = Math.abs(nextPixelRatio - pixelRatio) >= 0.01
      if (hasPreviousViewport && !logicalSizeChanged && !pixelRatioChanged) {
        return
      }

      const previousCenter = projection.translate() as [number, number]
      const previousBaseRadius = renderedBaseRadius
      const shouldAnimate =
        hasPreviousViewport &&
        logicalSizeChanged &&
        !prefersReducedMotion.matches &&
        (hadActiveTransition ||
          widthDelta >= VIEWPORT_TRANSITION_MIN_DELTA_PX ||
          heightDelta >= VIEWPORT_TRANSITION_MIN_DELTA_PX)

      width = nextWidth
      height = nextHeight
      pixelRatio = nextPixelRatio
      canvas.width = Math.round(width * pixelRatio)
      canvas.height = Math.round(height * pixelRatio)
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
      baseRadiusRef.current = nextBaseRadius

      if (shouldAnimate) {
        // The wrapper snaps to its final width so the canvas backing store is
        // allocated once. Only the projection interpolates, keeping the
        // drawer transition smooth without a ResizeObserver allocation loop.
        viewportTransition = {
          startedAt: now,
          fromCenter: previousCenter,
          toCenter: targetCenter,
          fromBaseRadius: previousBaseRadius,
          toBaseRadius: nextBaseRadius,
        }
      } else if (logicalSizeChanged || !hasPreviousViewport) {
        viewportTransition = null
        renderedBaseRadius = nextBaseRadius
        projection.translate(targetCenter)
      }

      projection
        .rotate(rotationRef.current)
        .scale(renderedBaseRadius * zoomRef.current)
      renderVersionRef.current += 1
      draw()
    }

    const draw = () => {
      context.clearRect(0, 0, width, height)
      const radius = projection.scale()
      const center = projection.translate()
      const scaleFactor = radius / Math.max(1, renderedBaseRadius)
      context.save()
      context.beginPath()
      context.arc(center[0], center[1], radius, 0, Math.PI * 2)
      context.fillStyle = "#070b0a"
      context.fill()
      context.strokeStyle = "rgba(255, 255, 255, 0.24)"
      context.lineWidth = Math.max(0.75, 1.1 * scaleFactor)
      context.stroke()
      context.clip()

      context.beginPath()
      path(GRATICULE)
      context.strokeStyle = "rgba(167, 243, 208, 0.07)"
      context.lineWidth = Math.max(0.5, 0.65 * scaleFactor)
      context.stroke()

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
        context.beginPath()
        path(highlight)
        context.fillStyle = "rgba(255, 255, 255, 0.08)"
        context.fill()
        context.strokeStyle = "rgba(255, 255, 255, 0.5)"
        context.lineWidth = 1
        context.stroke()
      }

      context.beginPath()
      path(LAND)
      context.fillStyle = landPattern ?? "rgba(226, 232, 240, 0.42)"
      context.fill()
      context.strokeStyle = "rgba(255, 255, 255, 0.34)"
      context.lineWidth = Math.max(0.45, 0.72 * scaleFactor)
      context.stroke()

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

      const clusters: RenderedCluster[] = []
      for (const projectedMarket of projectedMarkets) {
        const nearby = clusters.find(
          (cluster) =>
            Math.hypot(
              cluster.x - projectedMarket.x,
              cluster.y - projectedMarket.y,
            ) < 24,
        )
        if (nearby) {
          const count = nearby.markets.length
          nearby.x = (nearby.x * count + projectedMarket.x) / (count + 1)
          nearby.y = (nearby.y * count + projectedMarket.y) / (count + 1)
          nearby.markets.push(projectedMarket.market)
        } else {
          clusters.push({
            x: projectedMarket.x,
            y: projectedMarket.y,
            markets: [projectedMarket.market],
          })
        }
      }
      clustersRef.current = clusters

      for (const cluster of clusters) {
        const selected = cluster.markets.some(
          (market) => market.id === selectedMarketIdRef.current,
        )
        const markerMarket =
          cluster.markets.find(
            (market) => market.id === selectedMarketIdRef.current,
          ) ?? cluster.markets[0]
        if (!markerMarket) continue
        let glyphCategory = markerMarket.category
        if (!selected && cluster.markets.length > 1) {
          const categoryCounts = new Map<MarketCategory, number>()
          for (const market of cluster.markets) {
            categoryCounts.set(
              market.category,
              (categoryCounts.get(market.category) ?? 0) + 1,
            )
          }
          let highestCategoryCount = 0
          for (const [category, count] of categoryCounts) {
            if (count > highestCategoryCount) {
              glyphCategory = category
              highestCategoryCount = count
            }
          }
        }
        const markerRadius = cluster.markets.length > 1 ? 10 : 9
        const hovered = cluster.markets.some(
          (market) =>
            market.id === hoveredMarketIdRef.current ||
            market.id === hoveredCanvasMarketIdRef.current,
        )

        // Shape, rather than color, identifies the hazard. Mixed clusters show
        // their dominant category while the numeric badge signals aggregation.
        context.beginPath()
        context.arc(
          cluster.x,
          cluster.y,
          markerRadius + (selected ? 5 : 3),
          0,
          Math.PI * 2,
        )
        context.strokeStyle = selected
          ? "rgba(255, 255, 255, 0.92)"
          : "rgba(255, 255, 255, 0.28)"
        context.lineWidth = selected ? 1.6 : 1
        context.stroke()

        if (selected || hovered) {
          context.beginPath()
          context.arc(
            cluster.x,
            cluster.y,
            markerRadius + (selected ? 9 : 7),
            0,
            Math.PI * 2,
          )
          context.strokeStyle = selected
            ? "rgba(255, 255, 255, 0.18)"
            : "rgba(255, 255, 255, 0.14)"
          context.lineWidth = 1
          context.stroke()
        }

        context.beginPath()
        context.arc(cluster.x, cluster.y, markerRadius, 0, Math.PI * 2)
        context.fillStyle = selected ? "#f8fafc" : "rgba(3, 8, 7, 0.9)"
        context.fill()
        context.strokeStyle = "rgba(255, 255, 255, 0.82)"
        context.lineWidth = selected ? 1.5 : 1
        context.stroke()

        drawHazardGlyph(
          context,
          glyphCategory,
          cluster.x,
          cluster.y,
          selected ? "#050807" : "rgba(255, 255, 255, 0.96)",
        )

        if (cluster.markets.length > 1) {
          const badgeX = cluster.x + markerRadius
          const badgeY = cluster.y - markerRadius
          context.beginPath()
          context.arc(badgeX, badgeY, 5.5, 0, Math.PI * 2)
          context.fillStyle = "#ffffff"
          context.fill()
          context.strokeStyle = "#050807"
          context.lineWidth = 1
          context.stroke()
          context.fillStyle = "#050807"
          context.font = "700 7px Inter, system-ui, sans-serif"
          context.textAlign = "center"
          context.textBaseline = "middle"
          context.fillText(String(cluster.markets.length), badgeX, badgeY + 0.5)
        }
      }
      context.restore()
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
        projection.translate([width / 2, height / 2])
      }
      projection
        .rotate(rotationRef.current)
        .scale(renderedBaseRadius * zoomRef.current)

      const rotation = rotationRef.current
      const linkedHover = hoveredMarketIdRef.current
      const canvasHover = hoveredCanvasMarketIdRef.current
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
      (item) => Math.hypot(item.x - x, item.y - y) <= 24,
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
        question: targetMarket.question.replace(/^\[DEMO\]\s*/i, ""),
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
            ? `${target.cluster.markets.length} nearby hazard markets · select to explore`
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
      else callbacksRef.current.onRegionSelect(market.continent)
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
          aria-label="Interactive halftone globe with demo climate market markers. Drag or use arrow keys to rotate, scroll or use plus and minus keys to zoom."
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
