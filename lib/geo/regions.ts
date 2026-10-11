export const CONTINENTS = [
  "North America",
  "South America",
  "Europe",
  "Africa",
  "Asia",
  "Oceania",
] as const

export type ContinentName = (typeof CONTINENTS)[number]

export const REGION_CENTERS: Record<ContinentName, readonly [number, number]> =
  {
    "North America": [-102, 42],
    "South America": [-60, -18],
    Europe: [15, 51],
    Africa: [20, 4],
    Asia: [87, 34],
    Oceania: [135, -25],
  }

const REGION_RADIUS: Record<ContinentName, number> = {
  "North America": 26,
  "South America": 22,
  Europe: 14,
  Africa: 22,
  Asia: 30,
  Oceania: 22,
}

const toRadians = (value: number) => (value * Math.PI) / 180

export function closestContinent(
  longitude: number,
  latitude: number,
): ContinentName | null {
  let closest: { continent: ContinentName; distance: number } | null = null

  for (const continent of CONTINENTS) {
    const [centerLongitude, centerLatitude] = REGION_CENTERS[continent]
    const deltaLongitude = toRadians(longitude - centerLongitude)
    const firstLatitude = toRadians(latitude)
    const secondLatitude = toRadians(centerLatitude)
    const cosineDistance =
      Math.sin(firstLatitude) * Math.sin(secondLatitude) +
      Math.cos(firstLatitude) *
        Math.cos(secondLatitude) *
        Math.cos(deltaLongitude)
    const distance =
      (Math.acos(Math.max(-1, Math.min(1, cosineDistance))) * 180) / Math.PI

    if (!closest || distance < closest.distance) {
      closest = { continent, distance }
    }
  }

  if (!closest || closest.distance > REGION_RADIUS[closest.continent])
    return null
  return closest.continent
}

export function isContinentName(value: string): value is ContinentName {
  return CONTINENTS.some((continent) => continent === value)
}
