import React from "react";
import { render, screen, within } from "@testing-library/react";
import VenuesDiscoveryPage from "@/app/venues/page";

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/venues",
}));

// The page is a layout shell: the map pane and the draggable split are not what
// these tests are about, so render the two panes plainly.
jest.mock("@/components/venues/SplitPaneWorkspace", () => ({
  SplitPaneWorkspace: ({
    leftPane,
    rightPane,
  }: {
    leftPane?: React.ReactNode;
    rightPane?: React.ReactNode;
  }) => (
    <div>
      {leftPane}
      {rightPane}
    </div>
  ),
}));

describe("Venues discovery feed badges on small screens (#7726)", () => {
  it("renders a noise badge for every venue card", () => {
    render(<VenuesDiscoveryPage />);
    const results = screen.getByTestId("venue-discovery-results");
    expect(
      within(results).getAllByTestId("venue-noise-badge").length,
    ).toBeGreaterThan(0);
  });

  it("keeps each noise badge on one line instead of wrapping", () => {
    render(<VenuesDiscoveryPage />);
    for (const badge of screen.getAllByTestId("venue-noise-badge")) {
      expect(badge.className).toContain("whitespace-nowrap");
    }
  });

  it("does not let a noise badge shrink, and truncates it if it ever overflows", () => {
    render(<VenuesDiscoveryPage />);
    for (const badge of screen.getAllByTestId("venue-noise-badge")) {
      expect(badge.className).toContain("shrink-0");
      expect(badge.className).toContain("truncate");
      expect(badge.className).toContain("max-w-[60%]");
    }
  });

  it("uses a smaller badge font below the sm breakpoint", () => {
    render(<VenuesDiscoveryPage />);
    const badge = screen.getAllByTestId("venue-noise-badge")[0];
    expect(badge.className).toContain("text-[9px]");
    expect(badge.className).toContain("sm:text-[10px]");
  });

  it("keeps the full noise text in the title and the DOM", () => {
    render(<VenuesDiscoveryPage />);
    const badge = screen.getAllByTestId("venue-noise-badge")[0];
    expect(badge).toHaveTextContent("42 dB • Quiet");
    expect(badge).toHaveAttribute("title", "42 dB • Quiet");
  });

  it("keeps the desks-available status on one line", () => {
    render(<VenuesDiscoveryPage />);
    for (const status of screen.getAllByTestId("venue-desks-status")) {
      expect(status.className).toContain("whitespace-nowrap");
    }
  });

  it("lets the title wrap and the badge row gap instead of squeezing the badge", () => {
    render(<VenuesDiscoveryPage />);
    const badge = screen.getAllByTestId("venue-noise-badge")[0];
    const header = badge.parentElement as HTMLElement;
    expect(header.className).toContain("gap-2");
    expect(header.className).toContain("items-start");
    expect(header.querySelector("h3")?.className).toContain("min-w-0");
  });
});
