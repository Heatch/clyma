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
            <path d="M4 13.2c.8 4.4 5.3 7.1 9.6 5.6 3.6-1.2 5.6-5.1 4.1-8.6C16.4 7 12.8 5.4 9.6 6.7c-2.4 1-3.7 3.6-2.7 6 .8 2 3.1 3 5.1 2.2 1.5-.6 2.3-2.3 1.7-3.8-.5-1.2-1.8-1.8-3-1.3" />
            <circle
              cx="10.6"
              cy="11.8"
              r="0.75"
              fill="currentColor"
              stroke="none"
            />
          </>
        )
      case "drought":
        return (
          <>
            <circle cx="12" cy="7" r="3" />
            <path d="M12 1.5v2M6.6 2.8l1.2 1.6M17.4 2.8l-1.2 1.6M3 15.5h18M4 20h4l2.1-3.2 2.3 5.2 2.1-3h5.5" />
          </>
        )
      case "temperature":
        return (
          <>
            <path d="M9.5 13.5V5a2.5 2.5 0 0 1 5 0v8.5a4.5 4.5 0 1 1-5 0Z" />
            <path d="M12 7v8.1" />
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
            <path d="M6 13.5h11a3.5 3.5 0 0 0 .4-7A5.2 5.2 0 0 0 7.7 5 4.3 4.3 0 0 0 6 13.5Z" />
            <path d="m8 17-1 2M12.5 17l-1 2M17 17l-1 2" />
          </>
        )
      case "flooding":
        return (
          <>
            <path d="M3 9.5c1.5 0 1.5-1.5 3-1.5s1.5 1.5 3 1.5S10.5 8 12 8s1.5 1.5 3 1.5S16.5 8 18 8s1.5 1.5 3 1.5M3 14c1.5 0 1.5-1.5 3-1.5S7.5 14 9 14s1.5-1.5 3-1.5 1.5 1.5 3 1.5 1.5-1.5 3-1.5 1.5 1.5 3 1.5M3 18.5c1.5 0 1.5-1.5 3-1.5s1.5 1.5 3 1.5 1.5-1.5 3-1.5 1.5 1.5 3 1.5 1.5-1.5 3-1.5 1.5 1.5 3 1.5" />
          </>
        )
      case "crop-yield":
        return (
          <>
            <path d="M12 21V9.5M12 14c-4.6 0-7-2.4-7-7 4.6 0 7 2.4 7 7ZM12 17c4.6 0 7-2.4 7-7-4.6 0-7 2.4-7 7Z" />
          </>
        )
      case "wildfire":
        return (
          <>
            <path d="M12.2 2.5c1 3.4-.9 4.8.5 6.6 1.1 1.4 2.6.3 2.6-1.5 2.6 2.2 4.2 4.8 3.5 7.7-.8 3.5-3.6 5.7-6.9 5.7-4 0-7.1-2.8-7.1-6.8 0-3.3 2.1-5.9 4.8-7.9-.2 2.5.5 3.9 1.7 4.5-.1-3.3 2.4-4.6.9-8.3Z" />
            <path d="M12 20.7c-1.7-.7-2.8-2-2.8-3.7 0-1.6.9-2.8 2.2-3.9.1 1.3.6 2 1.3 2.4.6-1.2 1.4-1.8 1.2-3.3 1.1 1.2 1.6 2.5 1.2 4-.4 1.9-1.6 3.5-3.1 4.5Z" />
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
      fill="none"
      focusable="false"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.5"
    >
      {mark}
    </svg>
  )
}
