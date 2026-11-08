import { render, screen } from "@testing-library/react";
import { HighlightedText } from "@/components/ui/HighlightedText";

describe("HighlightedText", () => {
  it("renders plain text when query is empty", () => {
    render(<HighlightedText text="Central Library" query="" />);
    expect(screen.getByText("Central Library")).toBeInTheDocument();
    expect(document.querySelector("mark")).toBeNull();
  });

  it("renders plain text when query is whitespace", () => {
    render(<HighlightedText text="Daily Grind Café" query="   " />);
    expect(document.querySelector("mark")).toBeNull();
  });

  it("highlights a matching substring case-insensitively", () => {
    render(<HighlightedText text="The Roasted Bean Café" query="bean" />);
    const mark = document.querySelector("mark");
    expect(mark).not.toBeNull();
    expect(mark!.textContent).toBe("Bean");
  });

  it("highlights all occurrences of the query", () => {
    render(<HighlightedText text="coffee coffee shop" query="coffee" />);
    const marks = document.querySelectorAll("mark");
    expect(marks.length).toBe(2);
  });

  it("preserves original casing in highlighted text", () => {
    render(<HighlightedText text="WeWork Downtown" query="WEwork" />);
    const mark = document.querySelector("mark");
    expect(mark!.textContent).toBe("WeWork");
  });

  it("does not crash on regex special characters in query", () => {
    expect(() =>
      render(<HighlightedText text="c++ workspace" query="c++" />),
    ).not.toThrow();
  });

  it("applies custom highlightClassName to marks", () => {
    render(
      <HighlightedText
        text="Library café"
        query="café"
        highlightClassName="custom-highlight"
      />,
    );
    const mark = document.querySelector("mark");
    expect(mark!.className).toContain("custom-highlight");
  });

  it("renders non-matching text parts outside <mark>", () => {
    render(<HighlightedText text="The Daily Grind" query="daily" />);
    const container = document.querySelector("span");
    expect(container!.textContent).toBe("The Daily Grind");
    const mark = document.querySelector("mark");
    expect(mark!.textContent).toBe("Daily");
  });
});
