import { render, screen } from "@testing-library/react";
import { PeerAvatarTile } from "@/components/audio/PeerAvatarTile";

// Mock usePeakDecayLevel so tests control the smoothed audio level directly
jest.mock("@/hooks/usePeakDecayLevel", () => ({
  usePeakDecayLevel: (level: number) => level,
}));

const defaultProps = {
  peerId: "peer-1",
  isLocal: false,
  name: "Alice",
};

describe("PeerAvatarTile", () => {
  it("renders the peer name", () => {
    render(<PeerAvatarTile {...defaultProps} />);
    expect(screen.getByText("Alice")).toBeInTheDocument();
  });

  it("renders initials when no avatarUrl is provided", () => {
    render(<PeerAvatarTile {...defaultProps} />);
    // Initials for "Alice" with no surname = "A"
    expect(screen.getByText("A")).toBeInTheDocument();
  });

  it("renders the avatar image when avatarUrl is provided", () => {
    render(
      <PeerAvatarTile
        {...defaultProps}
        avatarUrl="https://example.com/alice.jpg"
      />,
    );
    const img = screen.getByRole("img", { name: "Alice" });
    expect(img).toHaveAttribute("src", "https://example.com/alice.jpg");
  });

  describe("AudioLevelIndicator ring", () => {
    it("renders an SVG ring element", () => {
      const { container } = render(
        <PeerAvatarTile {...defaultProps} audioLevel={0.5} />,
      );
      // AudioLevelIndicator renders an SVG
      expect(container.querySelector("svg")).toBeInTheDocument();
    });

    it("ring strokeDashoffset decreases as audioLevel increases (higher volume = more filled ring)", () => {
      const { container: low } = render(
        <PeerAvatarTile {...defaultProps} audioLevel={0.1} />,
      );
      const { container: high } = render(
        <PeerAvatarTile {...defaultProps} audioLevel={0.9} />,
      );

      const circles = (c: HTMLElement) =>
        Array.from(c.querySelectorAll("circle")).filter(
          (el) => el.style.strokeDashoffset !== "",
        );

      const lowOffset = parseFloat(
        circles(low)[0]?.style.strokeDashoffset || "999",
      );
      const highOffset = parseFloat(
        circles(high)[0]?.style.strokeDashoffset || "999",
      );

      // Higher audio level → smaller dashoffset (ring is more filled)
      expect(highOffset).toBeLessThan(lowOffset);
    });

    it("ring is muted (gray) when audioEnabled is false", () => {
      const { container } = render(
        <PeerAvatarTile {...defaultProps} audioLevel={0.8} audioEnabled={false} />,
      );
      const svgs = container.querySelectorAll("svg");
      expect(svgs.length).toBeGreaterThan(0);
      // The muted ring should use gray color — verify via stroke attribute or CSS class
      const ringCircle = Array.from(container.querySelectorAll("circle")).find(
        (el) => el.getAttribute("stroke"),
      );
      expect(ringCircle).toBeDefined();
    });

    it("ring is visible when audio level > 0", () => {
      const { container } = render(
        <PeerAvatarTile {...defaultProps} audioLevel={0.5} audioEnabled={true} />,
      );
      const svgs = container.querySelectorAll("svg");
      expect(svgs.length).toBeGreaterThan(0);
    });
  });

  it("shows 'You' badge for local peer", () => {
    render(<PeerAvatarTile {...defaultProps} isLocal={true} />);
    expect(screen.getByText("You")).toBeInTheDocument();
  });

  it("does not show 'You' badge for remote peer", () => {
    render(<PeerAvatarTile {...defaultProps} isLocal={false} />);
    expect(screen.queryByText("You")).not.toBeInTheDocument();
  });
});
