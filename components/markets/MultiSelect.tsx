"use client"

import { useEffect, useId, useRef, useState } from "react"

interface MultiSelectProps<Option extends string> {
  label: string
  allLabel: string
  options: ReadonlyArray<{ value: Option; label: string }>
  selected: readonly Option[]
  onToggle: (value: Option) => void
}

export default function MultiSelect<Option extends string>({
  label,
  allLabel,
  options,
  selected,
  onToggle,
}: MultiSelectProps<Option>) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const panelId = `multiselect-panel-${useId().replace(/:/g, "")}`
  const selectedLabels = options
    .filter((option) => selected.includes(option.value))
    .map((option) => option.label)
  const summary =
    selected.length === 0
      ? allLabel
      : selected.length === 1
        ? selectedLabels[0]
        : `${selected.length} selected`

  useEffect(() => {
    if (!open) return

    const handlePointerDown = (event: PointerEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setOpen(false)
      }
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault()
        setOpen(false)
        buttonRef.current?.focus()
      }
    }

    document.addEventListener("pointerdown", handlePointerDown)
    document.addEventListener("keydown", handleKeyDown)
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown)
      document.removeEventListener("keydown", handleKeyDown)
    }
  }, [open])

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={`${label}: ${summary}`}
        onClick={() => setOpen((currentlyOpen) => !currentlyOpen)}
        className="flex h-11 w-full items-center justify-between gap-3 rounded-lg border border-white/15 bg-white/[0.06] px-4 text-sm text-white outline-none transition hover:border-white/30 focus:border-white/60"
      >
        <span className="truncate">{summary}</span>
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className={`size-4 shrink-0 transition ${open ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div
          id={panelId}
          role="group"
          aria-label={`${label} options`}
          className="absolute inset-x-0 top-full z-30 mt-2 max-h-64 overflow-auto rounded-lg border border-white/15 bg-[#111413] p-2 shadow-[0_18px_55px_rgba(0,0,0,0.45)]"
        >
          {options.map((option) => (
            <label
              key={option.value}
              className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-2 text-sm text-neutral-200 transition hover:bg-white/5"
            >
              <input
                type="checkbox"
                checked={selected.includes(option.value)}
                onChange={() => onToggle(option.value)}
                className="size-4 accent-white"
              />
              {option.label}
            </label>
          ))}
        </div>
      )}
    </div>
  )
}
