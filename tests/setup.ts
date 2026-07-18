import "@testing-library/jest-dom/vitest"

class ResizeObserverMock implements ResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = ResizeObserverMock
}

if (typeof window !== "undefined") {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string): MediaQueryList => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }),
  })
}

const canvasContext = {
  arc: () => undefined,
  beginPath: () => undefined,
  clearRect: () => undefined,
  clip: () => undefined,
  closePath: () => undefined,
  fill: () => undefined,
  fillText: () => undefined,
  lineTo: () => undefined,
  moveTo: () => undefined,
  restore: () => undefined,
  save: () => undefined,
  setTransform: () => undefined,
  stroke: () => undefined,
  fillStyle: "#000000",
  font: "10px sans-serif",
  globalAlpha: 1,
  lineWidth: 1,
  shadowBlur: 0,
  shadowColor: "transparent",
  shadowOffsetY: 0,
  strokeStyle: "#000000",
  textAlign: "left" as CanvasTextAlign,
  textBaseline: "alphabetic" as CanvasTextBaseline,
}

if (typeof HTMLCanvasElement !== "undefined") {
  Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
    configurable: true,
    value: () => canvasContext,
  })
}

if (typeof window !== "undefined") {
  Object.defineProperty(window, "requestAnimationFrame", {
    configurable: true,
    value: () => 1,
  })

  Object.defineProperty(window, "cancelAnimationFrame", {
    configurable: true,
    value: () => undefined,
  })
}
