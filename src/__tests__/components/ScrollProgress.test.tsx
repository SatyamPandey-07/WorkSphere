import React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { ScrollProgress } from "@/components/ui/ScrollProgress";

// Mock useScrollProgress hook
const mockUseScrollProgress = jest.fn();
jest.mock("@/hooks/useScrollProgress", () => ({
  useScrollProgress: (...args: unknown[]) => mockUseScrollProgress(...args),
}));

describe("ScrollProgress Component", () => {
  beforeEach(() => {
    mockUseScrollProgress.mockReset();
    mockUseScrollProgress.mockReturnValue(0);
  });

  it("renders with default props and 0% width", () => {
    render(<ScrollProgress />);
    const bar = screen.getByTestId("scroll-progress-bar");
    expect(bar).toBeInTheDocument();
    expect(bar).toHaveStyle({ width: "0%" });
    expect(bar).toHaveAttribute("aria-hidden", "true");
  });

  it("applies width matching hook progress percentage", () => {
    mockUseScrollProgress.mockReturnValue(64.5);
    render(<ScrollProgress />);
    const bar = screen.getByTestId("scroll-progress-bar");
    expect(bar).toHaveStyle({ width: "64.5%" });
  });

  it("applies custom className", () => {
    render(<ScrollProgress className="custom-progress-style" />);
    const bar = screen.getByTestId("scroll-progress-bar");
    expect(bar).toHaveClass("custom-progress-style");
  });

  it("exposes accessible progressbar semantics when showAccessibleRole is true", () => {
    mockUseScrollProgress.mockReturnValue(75);
    render(<ScrollProgress showAccessibleRole={true} />);
    const bar = screen.getByTestId("scroll-progress-bar");
    expect(bar).toHaveAttribute("role", "progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "75");
    expect(bar).toHaveAttribute("aria-valuemin", "0");
    expect(bar).toHaveAttribute("aria-valuemax", "100");
    expect(bar).not.toHaveAttribute("aria-hidden");
  });

  it("passes targetRef options into useScrollProgress", () => {
    const dummyRef = { current: document.createElement("div") };
    render(<ScrollProgress targetRef={dummyRef} />);
    expect(mockUseScrollProgress).toHaveBeenCalledWith({ targetRef: dummyRef });
  });
});
