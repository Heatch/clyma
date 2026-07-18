import type { MarketCategory } from "@/lib/markets/types"

interface HazardIconProps {
  category: MarketCategory
  className?: string
}

/**
 * A compact, monochrome hazard mark for interface chrome.
 *
 * These icons are intentionally decorative: the category name is always
 * provided by adjacent text or the surrounding control's accessible label.
 */
export default function HazardIcon({ category, className }: HazardIconProps) {
  const mark = (() => {
    switch (category) {
      case "hurricane":
        return (
          <>
            <path d="M4.5 9.6c1.4-4 5.6-6.2 9.5-4.9 2.2.7 3.8 2.3 4.5 4.3-2.2-1.5-4.9-1.6-7-.3-1.3.8-2.1 2-2.4 3.3" />
            <path d="M19.5 14.4c-1.4 4-5.6 6.2-9.5 4.9-2.2-.7-3.8-2.3-4.5-4.3 2.2 1.5 4.9 1.6 7 .3 1.3-.8 2.1-2 2.4-3.3" />
            <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
          </>
        )
      case "drought":
        return (
          <>
            <circle cx="17.5" cy="6.5" r="2.7" />
            <path d="M3 13h18M5 20h3l2-3.8 2 2.3 1.5-5.5 2.2 4 1.3-2 2 5" />
          </>
        )
      case "temperature":
        return (
          <>
            <path d="M9.5 13.8V5a2.5 2.5 0 0 1 5 0v8.8a4.5 4.5 0 1 1-5 0Z" />
            <path d="M12 7.5v7.7M15.8 7h2M15.8 10h1.4" />
            <circle
              cx="12"
              cy="17.5"
              r="1.6"
              fill="currentColor"
              stroke="none"
            />
          </>
        )
      case "rainfall":
        return (
          <>
            <path d="M5.5 13h12.2a3.3 3.3 0 0 0 .3-6.6A5.1 5.1 0 0 0 8.4 5a4.1 4.1 0 0 0-2.9 8Z" />
            <path d="M8 16v3M12 16v4M16 16v3" />
          </>
        )
      case "flooding":
        return (
          <>
            <path d="m5 11 4-3.5 4 3.5v3M6.5 13.5V11h5" />
            <path d="M3 16c1.5 0 1.5-1.2 3-1.2S7.5 16 9 16s1.5-1.2 3-1.2 1.5 1.2 3 1.2 1.5-1.2 3-1.2 1.5 1.2 3 1.2M3 20c1.5 0 1.5-1.2 3-1.2S7.5 20 9 20s1.5-1.2 3-1.2 1.5 1.2 3 1.2 1.5-1.2 3-1.2 1.5 1.2 3 1.2" />
          </>
        )
      case "crop-yield":
        return (
          <>
            <path d="M12 21V5M12 9C9 9 7.5 7.5 7.5 4.5 10.5 4.5 12 6 12 9ZM12 13c3 0 4.5-1.5 4.5-4.5-3 0-4.5 1.5-4.5 4.5ZM12 17c-3 0-4.5-1.5-4.5-4.5 3 0 4.5 1.5 4.5 4.5Z" />
          </>
        )
      case "wildfire":
        return (
          <>
            <path d="M13 2.5c.6 3-2.6 5.1-1.1 7.3.7 1.1 2.1.5 2.3-.9 2.8 2.2 4.1 4.7 3 7.5-1 2.5-3.2 4.1-6 4.1-3.3 0-6-2.5-6-5.7 0-2.6 1.5-4.9 4-6.8-.1 2.2.6 3.6 1.8 4.2-.5-3.2 2.4-4.9 1.2-7.2Z" />
            <path d="M12 20c-1.4-.7-2.2-1.8-2.2-3.2 0-1.2.6-2.3 1.8-3.3.1 1.4.6 2.2 1.4 2.6.5-.9 1-1.6.8-2.7 1 1.1 1.4 2.2 1.1 3.5-.3 1.5-1.4 2.6-2.9 3.1Z" />
          </>
        )
      case "other":
        return (
          <>
            <path d="M12 3 21 20H3L12 3Z" />
            <path d="M12 9v5" />
            <circle cx="12" cy="17" r="0.8" fill="currentColor" stroke="none" />
          </>
        )
    }
  })()

  return (
    <svg
      aria-hidden="true"
      className={className}
      data-hazard-icon={category}
      fill="none"
      focusable="false"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
    >
      {mark}
    </svg>
  )
}
