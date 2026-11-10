import React from "react";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { VerifiedExplorerBadge } from "@/components/badges/VerifiedExplorerBadge";

describe("VerifiedExplorerBadge", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("renders correctly when earned=true prop is provided", () => {
    render(<VerifiedExplorerBadge earned={true} />);

    const badge = screen.getByTestId("verified-explorer-badge");
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveAttribute("aria-label", "Verified Explorer Badge (Earned)");
    expect(screen.getByText("Verified Explorer")).toBeInTheDocument();
  });

  it("renders correctly when earned=false prop is provided", () => {
    render(<VerifiedExplorerBadge earned={false} />);

    const badge = screen.getByTestId("verified-explorer-badge");
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveAttribute("aria-label", "Verified Explorer Badge (0 of 5)");
    expect(screen.getByText("Explorer (0/5)")).toBeInTheDocument();
  });

  it("toggles tooltip on click and triggers onTooltipToggle callback", () => {
    const onTooltipToggle = jest.fn();
    render(<VerifiedExplorerBadge earned={true} onTooltipToggle={onTooltipToggle} />);

    const badge = screen.getByTestId("verified-explorer-badge");
    expect(screen.queryByTestId("badge-tooltip")).not.toBeInTheDocument();

    fireEvent.click(badge);
    expect(screen.getByTestId("badge-tooltip")).toBeInTheDocument();
    expect(onTooltipToggle).toHaveBeenCalledWith(true);

    fireEvent.click(badge);
    expect(screen.queryByTestId("badge-tooltip")).not.toBeInTheDocument();
    expect(onTooltipToggle).toHaveBeenCalledWith(false);
  });

  it("handles mouse hover and keyboard navigation (Enter, Space, Escape)", () => {
    render(<VerifiedExplorerBadge earned={false} />);

    const badge = screen.getByTestId("verified-explorer-badge");

    // Mouse enter / leave
    fireEvent.mouseEnter(badge);
    expect(screen.getByTestId("badge-tooltip")).toBeInTheDocument();

    fireEvent.mouseLeave(badge);
    expect(screen.queryByTestId("badge-tooltip")).not.toBeInTheDocument();

    // Keyboard Enter
    fireEvent.keyDown(badge, { key: "Enter" });
    expect(screen.getByTestId("badge-tooltip")).toBeInTheDocument();

    // Keyboard Escape
    fireEvent.keyDown(badge, { key: "Escape" });
    expect(screen.queryByTestId("badge-tooltip")).not.toBeInTheDocument();

    // Keyboard Space
    fireEvent.keyDown(badge, { key: " " });
    expect(screen.getByTestId("badge-tooltip")).toBeInTheDocument();
  });

  it("fetches badge details from /api/user/badges when earned prop is omitted", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        badges: [
          {
            id: "verified_explorer",
            earned: false,
            progress: 3,
            target: 5,
          },
        ],
      }),
    });

    render(<VerifiedExplorerBadge />);

    await waitFor(() => {
      expect(screen.getByText("Explorer (3/5)")).toBeInTheDocument();
    });

    expect(global.fetch).toHaveBeenCalledWith("/api/user/badges");
  });

  it("safely handles non-array badges in API response", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        badges: "not-an-array",
      }),
    });

    const { container } = render(<VerifiedExplorerBadge />);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith("/api/user/badges");
    });

    // Should not crash and render null
    expect(container.firstChild).toBeNull();
  });

  it("protects against target=0 or negative values without NaN in progress bar", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        badges: [
          {
            id: "verified_explorer",
            earned: false,
            progress: 2,
            target: 0,
          },
        ],
      }),
    });

    render(<VerifiedExplorerBadge />);

    await waitFor(() => {
      expect(screen.getByTestId("verified-explorer-badge")).toBeInTheDocument();
    });

    // Open tooltip to inspect progress bar
    fireEvent.click(screen.getByTestId("verified-explorer-badge"));
    const progressBar = screen.getByTestId("badge-progress-bar");
    expect(progressBar).toBeInTheDocument();
    expect(progressBar.style.width).not.toContain("NaN");
  });

  it("applies custom className, testId, and description", () => {
    render(
      <VerifiedExplorerBadge
        earned={true}
        className="custom-badge-class"
        testId="custom-explorer-badge"
        description="Custom explorer description"
      />,
    );

    const badge = screen.getByTestId("custom-explorer-badge");
    expect(badge).toHaveClass("custom-badge-class");

    fireEvent.click(badge);
    expect(screen.getByText("Custom explorer description")).toBeInTheDocument();
  });
});
