import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { EmptyState } from "@/components/ui/EmptyState";

// Mock framer-motion to prevent animation-related test failures
// and safely simulate the useReducedMotion hook we added
jest.mock("framer-motion", () => {
  const actual = jest.requireActual("framer-motion");
  return {
    ...actual,
    useReducedMotion: jest.fn(() => false),
  };
});

describe("EmptyState — default variant", () => {
  it("renders search empty state correctly", () => {
    render(
      <EmptyState
        illustration="search"
        message="No venues found"
        description="Try adjusting your filters"
      />,
    );

    expect(screen.getByText("No venues found")).toBeInTheDocument();
    expect(screen.getByText("Try adjusting your filters")).toBeInTheDocument();
  });

  it("renders collection empty state correctly", () => {
    render(
      <EmptyState
        illustration="collection"
        message="No collections"
        description="Create your first collection"
      />,
    );

    expect(screen.getByText("No collections")).toBeInTheDocument();
    expect(
      screen.getByText("Create your first collection"),
    ).toBeInTheDocument();
  });

  it("renders chat empty state correctly", () => {
    render(
      <EmptyState
        illustration="chat"
        message="No chat history"
        description="Start a new search to save history"
      />,
    );

    expect(screen.getByText("No chat history")).toBeInTheDocument();
    expect(
      screen.getByText("Start a new search to save history"),
    ).toBeInTheDocument();
  });

  it("renders action button when provided", () => {
    render(
      <EmptyState
        illustration="chat"
        message="No chat history"
        action={<button>Retry</button>}
      />,
    );

    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("exposes data-variant='default' attribute when variant is omitted", () => {
    render(<EmptyState illustration="search" message="Nothing here" />);
    expect(screen.getByTestId("empty-state")).toHaveAttribute(
      "data-variant",
      "default",
    );
  });

  it("applies custom className to the root element", () => {
    render(
      <EmptyState
        illustration="search"
        message="Test"
        className="my-custom-class"
      />,
    );
    expect(screen.getByTestId("empty-state").className).toContain(
      "my-custom-class",
    );
  });

  it("does not render HUD corner brackets in default variant", () => {
    render(<EmptyState illustration="search" message="No results" />);
    expect(
      screen.queryByTestId("hud-corner-brackets"),
    ).not.toBeInTheDocument();
  });

  it("has role='status' and aria-live='polite' for screen-reader announcements", () => {
    render(<EmptyState illustration="search" message="Empty" />);
    const el = screen.getByTestId("empty-state");
    expect(el).toHaveAttribute("role", "status");
    expect(el).toHaveAttribute("aria-live", "polite");
  });
});

describe("EmptyState — HUD variant (#6173)", () => {
  it("renders with data-variant='hud' when variant='hud' is passed", () => {
    render(
      <EmptyState illustration="search" message="No results" variant="hud" />,
    );
    expect(screen.getByTestId("empty-state")).toHaveAttribute(
      "data-variant",
      "hud",
    );
  });

  it("renders HUD corner-bracket SVG overlay", () => {
    render(
      <EmptyState illustration="search" message="No results" variant="hud" />,
    );
    expect(screen.getByTestId("hud-corner-brackets")).toBeInTheDocument();
  });

  it("applies chamfered clip-path style to root element", () => {
    render(
      <EmptyState illustration="search" message="No results" variant="hud" />,
    );
    const root = screen.getByTestId("empty-state");
    expect(root.style.clipPath).toMatch(/polygon/i);
    // Should contain 18px bevel offsets
    expect(root.style.clipPath).toContain("18px");
  });

  it("applies emerald border class for HUD variant", () => {
    render(
      <EmptyState illustration="search" message="No results" variant="hud" />,
    );
    const root = screen.getByTestId("empty-state");
    expect(root.className).toContain("border-emerald-500");
  });

  it("applies zinc-950 dark background in HUD variant", () => {
    render(
      <EmptyState illustration="search" message="No results" variant="hud" />,
    );
    expect(screen.getByTestId("empty-state").className).toContain("bg-zinc-950");
  });

  it("uses emerald text color for the message heading in HUD variant", () => {
    render(
      <EmptyState illustration="search" message="Radar Clear" variant="hud" />,
    );
    const heading = screen.getByTestId("empty-state-message");
    expect(heading.className).toContain("text-emerald-300");
  });

  it("uses emerald text color for the description in HUD variant", () => {
    render(
      <EmptyState
        illustration="search"
        message="Radar Clear"
        description="No contacts detected"
        variant="hud"
      />,
    );
    const desc = screen.getByTestId("empty-state-description");
    expect(desc.className).toContain("text-emerald-400");
  });

  it("renders action content in HUD variant", () => {
    render(
      <EmptyState
        illustration="search"
        message="No targets"
        action={<button>Rescan</button>}
        variant="hud"
      />,
    );
    expect(screen.getByRole("button", { name: "Rescan" })).toBeInTheDocument();
    expect(screen.getByTestId("empty-state-action")).toBeInTheDocument();
  });

  it("renders all three illustration types inside HUD variant", () => {
    const { rerender } = render(
      <EmptyState illustration="search" message="Scan" variant="hud" />,
    );
    expect(screen.getByTestId("hud-corner-brackets")).toBeInTheDocument();

    rerender(
      <EmptyState illustration="collection" message="Archive" variant="hud" />,
    );
    expect(screen.getByTestId("hud-corner-brackets")).toBeInTheDocument();

    rerender(
      <EmptyState illustration="chat" message="Comms" variant="hud" />,
    );
    expect(screen.getByTestId("hud-corner-brackets")).toBeInTheDocument();
  });

  it("does not render corner brackets in default variant when switching from hud", () => {
    const { rerender } = render(
      <EmptyState illustration="search" message="Scan" variant="hud" />,
    );
    expect(screen.getByTestId("hud-corner-brackets")).toBeInTheDocument();

    rerender(<EmptyState illustration="search" message="Scan" variant="default" />);
    expect(
      screen.queryByTestId("hud-corner-brackets"),
    ).not.toBeInTheDocument();
  });

  it("accepts custom className and merges it with HUD classes", () => {
    render(
      <EmptyState
        illustration="search"
        message="No results"
        variant="hud"
        className="custom-hud"
      />,
    );
    expect(screen.getByTestId("empty-state").className).toContain("custom-hud");
  });
});
