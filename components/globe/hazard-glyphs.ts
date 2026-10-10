import type { MarketCategory } from "@/lib/markets/types"

/**
 * Inline SVG glyphs for the globe's hazard markers.
 *
 * Rendered as DOM nodes in an overlay above the globe canvas, so each glyph
 * can be large, multi-colour and CSS-animated without redrawing the canvas.
 *
 * Style system (kept identical across every category so the set reads as one
 * family and matches the site's flat, technical look):
 *  - a 32×32 viewBox drawn to `HAZARD_GLYPH_SIZE_PX`;
 *  - flat opaque fills, no gradients, no outlines or shadows;
 *  - at most two or three flat tones per glyph, drawn from the category's
 *    accent family;
 *  - a uniform 2.2 stroke weight and rounded caps/joins where strokes appear;
 *  - one quiet, mechanical motion per category (`hg-*` classes in globals.css).
 *
 * Bodies are kept separate from the `<svg>` wrapper so a mixed cluster can
 * compose several of them into one "grouped" glyph.
 */

/** Rendered glyph box, in CSS pixels. Mirrors `GLYPH_SIZE_PX` in clustering. */
export const HAZARD_GLYPH_SIZE_PX = 34

/** Archimedean spiral as a smooth polyline — the hurricane's vortex. */
function spiralPath(
  cx: number,
  cy: number,
  innerRadius: number,
  outerRadius: number,
  turns: number,
  steps = 64,
): string {
  const total = turns * Math.PI * 2
  const commands: string[] = []
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps
    const angle = t * total
    const radius = innerRadius + (outerRadius - innerRadius) * t
    const x = cx + radius * Math.cos(angle)
    const y = cy + radius * Math.sin(angle)
    commands.push(`${i === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`)
  }
  return commands.join(" ")
}

const GLYPH_BODIES: Record<MarketCategory, string> = {
  hurricane: `
    <g class="hg-spin">
      <path d="${spiralPath(16, 16, 2.6, 9.4, 1.7)}"
        fill="none" stroke="#a78bfa" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
    </g>
    <circle cx="16" cy="16" r="1.7" fill="#ede9fe"/>`,
  drought: `
    <g class="hg-sun" stroke="#f97316" stroke-width="2" stroke-linecap="round">
      <circle cx="11" cy="9.5" r="4.3" fill="#fb923c"/>
      <path d="M11 2.2v2.2M11 14.6v2.2M3.7 9.5h2.2M16.1 9.5h2.2M5.9 4.4 7.4 5.9M14.6 13.1l1.5 1.5M16.1 4.4 14.6 5.9M7.4 13.1 5.9 14.6"/>
    </g>
    <path d="M2.5 21h6.1l2.2 2.4 2.2-2.4h6.4l2.2 2.4 2.2-2.4h4.7"
      fill="none" stroke="#c2410c" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M8.2 21l-1.7 4.2M16 21l1.7 3.4-1.2 1.9M22.8 21l-1.5 3.3"
      fill="none" stroke="#9a3412" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>`,
  temperature: `
    <rect x="13.6" y="3.4" width="4.8" height="17.6" rx="2.4" fill="none" stroke="#e2e8f0" stroke-width="2.2"/>
    <circle cx="16" cy="24" r="4.4" fill="none" stroke="#e2e8f0" stroke-width="2.2"/>
    <g class="hg-mercury">
      <rect x="14.8" y="9.2" width="2.4" height="12.8" rx="1.2" fill="#ef4444"/>
    </g>
    <circle cx="16" cy="24" r="2.8" fill="#ef4444"/>
    <path d="M20.2 8.6h3.2M20.2 12.6h3.2M20.2 16.6h3.2" stroke="#94a3b8" stroke-width="1.8" stroke-linecap="round"/>`,
  rainfall: `
    <g fill="#cbd5e1">
      <circle cx="11" cy="14" r="4.6"/>
      <circle cx="18" cy="12.4" r="5.6"/>
      <circle cx="23" cy="15.4" r="3.6"/>
      <rect x="7" y="14" width="17" height="5.4" rx="2.7"/>
    </g>
    <g stroke="#38bdf8" stroke-width="2.4" stroke-linecap="round" fill="none">
      <line class="hg-drop hg-drop-1" x1="11" y1="21.8" x2="9.7" y2="25.4"/>
      <line class="hg-drop hg-drop-2" x1="16" y1="22" x2="14.7" y2="25.6"/>
      <line class="hg-drop hg-drop-3" x1="21" y1="21.8" x2="19.7" y2="25.4"/>
    </g>`,
  flooding: `
    <path d="M16 5 26.6 14.2H23.6V26.4H8.4V14.2H5.4Z" fill="#e2e8f0"/>
    <g class="hg-water">
      <path d="M2.6 19.8c3.4-1.9 6.4-1.9 9.8 0s6.4 1.9 9.8 0c2.4-1.3 4.4-1.3 6.6-.2V29.4H2.6Z" fill="#0ea5e9"/>
    </g>`,
  "crop-yield": `
    <g class="hg-sway">
      <path d="M16 28.6V9" fill="none" stroke="#ca8a04" stroke-width="2.6" stroke-linecap="round"/>
      <g fill="#facc15">
        <ellipse cx="16" cy="6.2" rx="2.2" ry="3.4"/>
        <ellipse cx="12.4" cy="10.2" rx="2.2" ry="3.2" transform="rotate(-30 12.4 10.2)"/>
        <ellipse cx="19.6" cy="10.2" rx="2.2" ry="3.2" transform="rotate(30 19.6 10.2)"/>
        <ellipse cx="12.7" cy="14.6" rx="2.1" ry="3" transform="rotate(-30 12.7 14.6)"/>
        <ellipse cx="19.3" cy="14.6" rx="2.1" ry="3" transform="rotate(30 19.3 14.6)"/>
        <ellipse cx="13" cy="19" rx="1.9" ry="2.7" transform="rotate(-30 13 19)"/>
        <ellipse cx="19" cy="19" rx="1.9" ry="2.7" transform="rotate(30 19 19)"/>
      </g>
    </g>`,
  wildfire: `
    <path d="M16 3.4c3.5 5.5 9.2 8.1 9.2 14.8 0 5.9-4.1 10.2-9.2 10.2s-9.2-4.3-9.2-10.2c0-6.7 5.7-9.3 9.2-14.8Z" fill="#f97316"/>
    <path class="hg-flame" d="M16 13.2c1.9 3 4.7 4.2 4.7 7.5 0 3.2-2.1 5.3-4.7 5.3s-4.7-2.1-4.7-5.3c0-3.3 2.8-4.5 4.7-7.5Z" fill="#fbbf24"/>`,
  other: `
    <circle cx="16" cy="16" r="11.6" fill="#64748b"/>
    <g class="hg-question">
      <path d="M12.8 12.6A3.2 3.2 0 0 1 19.2 12.6C19.2 15.4 16 15.4 16 17.8"
        fill="none" stroke="#f8fafc" stroke-width="2.6" stroke-linecap="round"/>
      <circle cx="16" cy="21.6" r="1.6" fill="#f8fafc"/>
    </g>`,
}

function wrap(body: string, className: string, attributes = ""): string {
  return `<svg class="hg ${className}" viewBox="0 0 32 32" ${attributes}aria-hidden="true" focusable="false">${body}</svg>`
}

export function hazardGlyphMarkup(category: MarketCategory): string {
  return wrap(
    GLYPH_BODIES[category],
    `hg-${category}`,
    `data-hazard-glyph="${category}" `,
  )
}

/**
 * Two or three mini hazard glyphs tiled together, shown instead of a single
 * category glyph whenever a cluster mixes hazard types — so a count never
 * implies that every market under it is the same hazard.
 */
export function hazardGroupMarkup(categories: readonly MarketCategory[]): string {
  const shown = categories.slice(0, 3)
  if (shown.length === 0) return hazardGlyphMarkup("other")
  if (shown.length === 1) return hazardGlyphMarkup(shown[0]!)

  const twoUp = shown.length === 2
  const scale = twoUp ? 0.68 : 0.62
  const centres: [number, number][] = twoUp
    ? [
        [10, 16],
        [22, 16],
      ]
    : [
        [16, 8],
        [7.5, 22],
        [24.5, 22],
      ]

  const tiles = shown
    .map((category, index) => {
      const [cx, cy] = centres[index]!
      const tx = (cx - 16 * scale).toFixed(2)
      const ty = (cy - 16 * scale).toFixed(2)
      return `<g transform="translate(${tx} ${ty}) scale(${scale})">${GLYPH_BODIES[category]}</g>`
    })
    .join("")

  return wrap(
    tiles,
    "hg-group",
    `data-hazard-glyph="group" data-hazard-categories="${shown.join(",")}" `,
  )
}

/**
 * Negative animation delay (in seconds) derived from the market id, so
 * glyphs sharing a category and screen area do not pulse in lockstep.
 */
export function hazardGlyphDelay(marketId: string): string {
  let hash = 2166136261
  for (let i = 0; i < marketId.length; i++) {
    hash ^= marketId.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  const offset = ((hash >>> 0) % 1000) / 1000
  return `-${(offset * 3).toFixed(3)}s`
}
