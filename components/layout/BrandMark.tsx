"use client"

import Image from "next/image"

/**
 * Clyma tree + wordmark, in that order. Positioned by the parent — currently
 * above the hero heading, top-left.
 */
export default function BrandMark() {
  return (
    <div
      className="flex items-center gap-3"
      aria-label="Clyma"
      data-testid="brand-mark"
    >
      <Image
        src="/clyma-logo-shadow.svg"
        alt=""
        aria-hidden="true"
        width={48}
        height={46}
        className="h-12 w-auto"
      />
      <span className="text-2xl font-semibold tracking-[-0.02em] text-white">
        Clyma
      </span>
    </div>
  )
}
