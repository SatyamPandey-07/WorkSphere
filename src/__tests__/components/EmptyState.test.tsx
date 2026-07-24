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

describe("EmptyState", () => {
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
});
