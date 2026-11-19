import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { SkipToContent } from "@/components/ui/SkipToContent";

describe("SkipToContent Component", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("renders skip link with default target and text", () => {
    render(<SkipToContent />);

    const link = screen.getByRole("link", { name: /skip to content/i });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute("href", "#main-content");
    expect(link).toHaveTextContent("Skip to content");
  });

  it("has the required WCAG 2.1 AA accessible CSS classes", () => {
    render(<SkipToContent />);

    const link = screen.getByRole("link", { name: /skip to content/i });
    expect(link).toHaveClass(
      "sr-only",
      "focus:not-sr-only",
      "focus:absolute",
      "focus:top-4",
      "focus:left-4",
      "focus:z-50",
      "focus:p-4",
      "focus:bg-blue-600",
      "focus:text-white"
    );
  });

  it("allows overriding children / label text", () => {
    render(<SkipToContent>Skip to main content</SkipToContent>);

    const link = screen.getByRole("link", { name: "Skip to main content" });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute("href", "#main-content");
  });

  it("allows specifying a custom targetId", () => {
    render(<SkipToContent targetId="primary-workspace" />);

    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "#primary-workspace");
  });

  it("merges custom className with default classes", () => {
    render(<SkipToContent className="custom-skip-class font-bold" />);

    const link = screen.getByRole("link");
    expect(link).toHaveClass(
      "custom-skip-class",
      "font-bold",
      "sr-only",
      "focus:not-sr-only",
      "focus:bg-blue-600",
      "focus:text-white"
    );
  });

  it("moves keyboard focus directly to target element on click", () => {
    // Create a target element in the document
    const mainContent = document.createElement("main");
    mainContent.id = "main-content";
    mainContent.tabIndex = -1;
    document.body.appendChild(mainContent);

    render(<SkipToContent />);

    const link = screen.getByRole("link", { name: /skip to content/i });
    fireEvent.click(link);

    expect(document.activeElement).toBe(mainContent);
  });

  it("sets tabindex='-1' on target if not already present and focuses it", () => {
    const mainContent = document.createElement("div");
    mainContent.id = "main-content";
    // Deliberately no tabindex set initially
    document.body.appendChild(mainContent);

    render(<SkipToContent />);

    const link = screen.getByRole("link", { name: /skip to content/i });
    fireEvent.click(link);

    expect(mainContent).toHaveAttribute("tabindex", "-1");
    expect(document.activeElement).toBe(mainContent);
  });

  it("moves focus to target on Space key activation and prevents default scroll", () => {
    const mainContent = document.createElement("main");
    mainContent.id = "main-content";
    mainContent.tabIndex = -1;
    document.body.appendChild(mainContent);

    render(<SkipToContent />);

    const link = screen.getByRole("link", { name: /skip to content/i });
    fireEvent.keyDown(link, { key: " " });

    expect(document.activeElement).toBe(mainContent);
  });

  it("triggers custom onClick and onKeyDown handlers when passed", () => {
    const handleClick = jest.fn();
    const handleKeyDown = jest.fn();

    render(
      <SkipToContent onClick={handleClick} onKeyDown={handleKeyDown} />
    );

    const link = screen.getByRole("link");
    fireEvent.click(link);
    expect(handleClick).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(link, { key: "Enter" });
    expect(handleKeyDown).toHaveBeenCalledTimes(1);
  });
});

