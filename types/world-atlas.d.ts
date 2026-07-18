declare module "world-atlas/land-110m.json" {
  const topology: {
    type: "Topology"
    objects: {
      land: unknown
    }
    arcs: unknown[]
    transform?: unknown
  }
  export default topology
}

declare module "world-atlas/countries-110m.json" {
  const topology: {
    type: "Topology"
    objects: {
      countries: unknown
      land: unknown
    }
    arcs: unknown[]
    transform?: unknown
  }
  export default topology
}
