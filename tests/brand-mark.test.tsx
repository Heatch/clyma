import React from "react"
import { render, screen } from "@testing-library/react"

import BrandMark from "@/components/layout/BrandMark"

describe("brand mark", () => {
  it("renders the wordmark before the tree in the bottom-right corner", () => {
    render(<BrandMark />)

    const mark = screen.getByTestId("brand-mark")
    expect(mark).toHaveClass(
      "right-4",
      "bottom-[max(1rem,env(safe-area-inset-bottom))]",
    )

    const wordmark = screen.getByText("Clyma")
    expect(wordmark).toHaveClass("text-2xl")

    const logo = screen.getByAltText("")
    expect(logo).toHaveAttribute("src", "/clyma-logo-shadow.svg")
    expect(logo).toHaveClass("h-12")

    // Wordmark comes before the logo in DOM order.
    expect(
      wordmark.compareDocumentPosition(logo) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })
})
