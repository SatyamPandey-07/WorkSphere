import React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { HolographicCompass } from "@/components/saved-venues/HolographicCompass";
import { EmptyBookmarksState } from "@/components/saved-venues/EmptyBookmarksState";
import { useReducedMotion } from "framer-motion";

jest.mock("framer-motion", () => {
  const actual = jest.requireActual("framer-motion");
  return {
    ...actual,
    useReducedMotion: jest.fn(),
  };
});

describe("HolographicCompass Component (#7206)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (useReducedMotion as jest.Mock).mockReturnValue(false);
  });

  it("renders holographic compass SVG and astrolabe dial rings", () => {
    render(<HolographicCompass size={140} />);

    const wrapper = screen.getByTestId("holographic-compass-wrapper");
    expect(wrapper).toBeInTheDocument();
    expect(wrapper).toHaveStyle({ width: "140px", height: "140px" });

    // Compass needle group
    const needleGroup = screen.getByTestId("compass-needle-group");
    expect(needleGroup).toBeInTheDocument();

    // Ambient glow layer
    expect(screen.getByTestId("holographic-ambient-glow")).toBeInTheDocument();
  });

  it("respects prefers-reduced-motion by disabling animations", () => {
    (useReducedMotion as jest.Mock).mockReturnValue(true);

    render(<HolographicCompass size={160} />);

    const needleGroup = screen.getByTestId("compass-needle-group");
    expect(needleGroup.style.animation).toBe("none");

    const ambientGlow = screen.getByTestId("holographic-ambient-glow");
    expect(ambientGlow.style.animation).toBe("none");
  });
});

describe("EmptyBookmarksState Component (#7206)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (useReducedMotion as jest.Mock).mockReturnValue(false);
  });

  it("renders the empty state card with heading, description, and CTA", () => {
    render(<EmptyBookmarksState />);

    // Region landmark
    const region = screen.getByRole("region", {
      name: "Empty saved workspaces",
    });
    expect(region).toBeInTheDocument();
    expect(region).toHaveAttribute("data-testid", "empty-bookmarks-state");

    // Title
    const title = screen.getByTestId("empty-bookmarks-title");
    expect(title).toBeInTheDocument();
    expect(title).toHaveTextContent("No saved workspaces yet");

    // Description
    const desc = screen.getByTestId("empty-bookmarks-description");
    expect(desc).toBeInTheDocument();
    expect(desc).toHaveTextContent(/Explore verified spaces, quiet study nooks/);

    // Call to Action
    const cta = screen.getByTestId("discover-workspaces-cta");
    expect(cta).toBeInTheDocument();
    expect(cta).toHaveAttribute("href", "/venues?search=true");
    expect(cta).toHaveTextContent("Discover Workspaces");
  });

  it("allows overriding CTA link destination and custom class names", () => {
    render(
      <EmptyBookmarksState
        ctaHref="/venues?category=cafe"
        className="custom-test-class"
      />
    );

    const region = screen.getByTestId("empty-bookmarks-state");
    expect(region.className).toContain("custom-test-class");

    const cta = screen.getByTestId("discover-workspaces-cta");
    expect(cta).toHaveAttribute("href", "/venues?category=cafe");
  });
});
