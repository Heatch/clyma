import React from "react"
import { render, screen } from "@testing-library/react"

import BrandMark from "@/components/layout/BrandMark"

describe("brand mark", () => {
  it("renders the tree before the wordmark as a plain row", () => {
    render(<BrandMark />)

    const mark = screen.getByTestId("brand-mark")
    expect(mark).toHaveClass("flex", "items-center")
    // Positioned by the parent: no absolute positioning of its own.
    expect(mark.className).not.toMatch(/absolute|bottom-|right-/)

    const logo = screen.getByAltText("")
    expect(logo).toHaveAttribute("src", "/clyma-logo-shadow.svg")
    expect(logo).toHaveClass("h-12")

    const wordmark = screen.getByText("Clyma")
    expect(wordmark).toHaveClass("text-2xl")

    // Tree comes before the wordmark in DOM order.
    expect(
      logo.compareDocumentPosition(wordmark) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })
})
