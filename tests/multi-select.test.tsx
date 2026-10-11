import React, { useState } from "react"
import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import MultiSelect from "@/components/markets/MultiSelect"

const OPTIONS = [
  { value: "apple", label: "Apple" },
  { value: "banana", label: "Banana" },
] as const

function Harness({
  onToggle,
}: {
  onToggle?: (value: "apple" | "banana") => void
}) {
  const [selected, setSelected] = useState<ReadonlyArray<"apple" | "banana">>(
    [],
  )

  return (
    <div>
      <button type="button">Outside</button>
      <MultiSelect
        label="Fruit"
        allLabel="All fruit"
        options={OPTIONS}
        selected={selected}
        onToggle={(value) => {
          onToggle?.(value)
          setSelected((previous) =>
            previous.includes(value)
              ? previous.filter((item) => item !== value)
              : [...previous, value],
          )
        }}
      />
    </div>
  )
}

function TwoMenus() {
  const [first, setFirst] = useState<ReadonlyArray<"apple" | "banana">>([])
  const [second, setSecond] = useState<ReadonlyArray<"apple" | "banana">>([])

  return (
    <div>
      <MultiSelect
        label="First"
        allLabel="All first"
        options={OPTIONS}
        selected={first}
        onToggle={(value) =>
          setFirst((previous) =>
            previous.includes(value)
              ? previous.filter((item) => item !== value)
              : [...previous, value],
          )
        }
      />
      <MultiSelect
        label="Second"
        allLabel="All second"
        options={OPTIONS}
        selected={second}
        onToggle={(value) =>
          setSecond((previous) =>
            previous.includes(value)
              ? previous.filter((item) => item !== value)
              : [...previous, value],
          )
        }
      />
    </div>
  )
}

describe("MultiSelect", () => {
  it("switches from one open menu to another", async () => {
    const user = userEvent.setup()
    render(<TwoMenus />)

    await user.click(screen.getByRole("button", { name: "First: All first" }))
    expect(
      within(screen.getByRole("group", { name: "First options" })).getByRole(
        "checkbox",
        { name: "Apple" },
      ),
    ).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Second: All second" }))
    expect(
      screen.queryByRole("group", { name: "First options" }),
    ).not.toBeInTheDocument()
    expect(
      within(screen.getByRole("group", { name: "Second options" })).getByRole(
        "checkbox",
        { name: "Apple" },
      ),
    ).toBeInTheDocument()
  })

  it("summarizes the selection and keeps the menu open while choosing", async () => {
    const user = userEvent.setup()
    const onToggle = vi.fn()
    render(<Harness onToggle={onToggle} />)

    const button = screen.getByRole("button", { name: "Fruit: All fruit" })
    await user.click(button)
    await user.click(screen.getByRole("checkbox", { name: "Apple" }))

    expect(onToggle).toHaveBeenCalledWith("apple")
    expect(
      screen.getByRole("button", { name: "Fruit: Apple" }),
    ).toBeInTheDocument()
    expect(screen.getByRole("checkbox", { name: "Apple" })).toBeChecked()

    await user.click(screen.getByRole("checkbox", { name: "Banana" }))
    expect(
      screen.getByRole("button", { name: "Fruit: 2 selected" }),
    ).toBeInTheDocument()
  })

  it("closes on Escape and returns focus to the trigger", async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await user.click(screen.getByRole("button", { name: "Fruit: All fruit" }))
    expect(screen.getByRole("checkbox", { name: "Apple" })).toBeInTheDocument()

    await user.keyboard("{Escape}")
    expect(
      screen.queryByRole("checkbox", { name: "Apple" }),
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "Fruit: All fruit" }),
    ).toHaveFocus()
  })

  it("closes when clicking outside the menu", async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await user.click(screen.getByRole("button", { name: "Fruit: All fruit" }))
    expect(screen.getByRole("checkbox", { name: "Apple" })).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Outside" }))
    expect(
      screen.queryByRole("checkbox", { name: "Apple" }),
    ).not.toBeInTheDocument()
  })

  it("exposes its options to assistive technology", () => {
    render(<Harness />)
    const button = screen.getByRole("button", { name: "Fruit: All fruit" })

    expect(button).toHaveAttribute("aria-expanded", "false")
    expect(button).toHaveAttribute("aria-controls")
    expect(
      within(document.body).queryByRole("group", { name: "Fruit options" }),
    ).not.toBeInTheDocument()
  })
})
