import type { SVGProps } from "react"

export default function TerraFormMark({
  className = "",
  ...props
}: SVGProps<SVGSVGElement>) {
  return (
    <svg
      {...props}
      viewBox="0 0 40 40"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <circle cx="20" cy="20" r="15.25" stroke="currentColor" />
      <ellipse
        cx="20"
        cy="20"
        rx="7.25"
        ry="15.25"
        stroke="currentColor"
        opacity="0.52"
      />
      <path d="M5 20h30" stroke="currentColor" opacity="0.52" />
      <path
        d="M8.5 12.25c3.4 1.7 7.25 2.55 11.5 2.55s8.1-.85 11.5-2.55M8.5 27.75c3.4-1.7 7.25-2.55 11.5-2.55s8.1.85 11.5 2.55"
        stroke="currentColor"
        opacity="0.32"
      />
      <circle cx="29.6" cy="10.6" r="1.6" fill="currentColor" />
    </svg>
  )
}
