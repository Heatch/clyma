"use client"

import Image from "next/image"

/**
 * Clyma wordmark + tree, pinned to the empty bottom-right corner of the
 * globe. Hidden while the drawer covers that corner.
 */
export default function BrandMark() {
  return (
    <div
      className="pointer-events-none absolute bottom-[max(1rem,env(safe-area-inset-bottom))] right-4 z-30 flex items-center gap-3 sm:right-6"
      aria-label="Clyma"
      data-testid="brand-mark"
    >
      <span className="text-2xl font-semibold tracking-[-0.02em] text-white">
        Clyma
      </span>
      <Image
        src="/clyma-logo-shadow.svg"
        alt=""
        aria-hidden="true"
        width={48}
        height={46}
        className="h-12 w-auto"
      />
    </div>
  )
}
