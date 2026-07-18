import "@testing-library/jest-dom/vitest"

class ResizeObserverMock implements ResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = ResizeObserverMock
}

// The shims below only make sense in the jsdom environment. Node-environment
// test files (e.g. the Solana client unit tests) skip them so setup stays safe.
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
    scale: () => undefined,
    setTransform: () => undefined,
    stroke: () => undefined,
    translate: () => undefined,
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

  Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
    configurable: true,
    value: () => canvasContext,
  })

  Object.defineProperty(window, "requestAnimationFrame", {
    configurable: true,
    value: () => 1,
  })

  Object.defineProperty(window, "cancelAnimationFrame", {
    configurable: true,
    value: () => undefined,
  })
}
