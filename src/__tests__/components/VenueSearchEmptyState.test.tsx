import { render, screen } from "@testing-library/react";
import { VenueSearchEmptyState } from "@/components/venues/VenueSearchEmptyState";

describe("VenueSearchEmptyState", () => {
  it("renders 'No venues found' heading", () => {
    render(<VenueSearchEmptyState />);
    expect(screen.getByText("No venues found")).toBeInTheDocument();
  });

  it("shows generic message when no searchQuery is provided", () => {
    render(<VenueSearchEmptyState />);
    expect(
      screen.getByText(/couldn't find any workspaces nearby/i),
    ).toBeInTheDocument();
  });

  it("shows query-specific message when searchQuery is provided", () => {
    render(<VenueSearchEmptyState searchQuery="coffee" />);
    expect(screen.getByText(/coffee/)).toBeInTheDocument();
  });

  it("renders tips list", () => {
    render(<VenueSearchEmptyState />);
    // Tips are rendered as list items
    const tips = screen.getAllByRole("listitem");
    expect(tips.length).toBeGreaterThanOrEqual(4);
  });

  it("has aria-live='polite' for accessibility announcements", () => {
    const { container } = render(<VenueSearchEmptyState />);
    expect(container.querySelector('[aria-live="polite"]')).toBeInTheDocument();
  });

  it("renders SVG illustration", () => {
    const { container } = render(<VenueSearchEmptyState />);
    expect(container.querySelector("svg")).toBeInTheDocument();
  });

  it("applies custom className", () => {
    const { container } = render(
      <VenueSearchEmptyState className="my-custom" />,
    );
    expect(
      (container.firstChild as HTMLElement).className,
    ).toContain("my-custom");
  });
});
