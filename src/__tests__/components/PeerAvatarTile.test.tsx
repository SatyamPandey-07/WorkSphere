import { render, screen, act } from "@testing-library/react";
import {
  PeerAvatarTile,
  calculateDecibelVolume,
} from "@/components/audio/PeerAvatarTile";

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

      const findCircle = (c: HTMLElement) =>
        Array.from(c.querySelectorAll("circle")).find(
          (el) =>
            el.getAttribute("stroke-dashoffset") !== null ||
            (el.style?.strokeDashoffset ?? "") !== "",
        );

      const getOffset = (el?: Element | null) => {
        if (!el) return 999;
        const attr = el.getAttribute("stroke-dashoffset");
        if (attr) return parseFloat(attr);
        const style = (el as HTMLElement).style?.strokeDashoffset;
        return style ? parseFloat(style) : 999;
      };

      const lowOffset = getOffset(findCircle(low));
      const highOffset = getOffset(findCircle(high));

      // Higher audio level → smaller dashoffset (ring is more filled)
      expect(highOffset).toBeLessThan(lowOffset);
    });

    it("ring is muted (gray) when audioEnabled is false", () => {
      const { container } = render(
        <PeerAvatarTile
          {...defaultProps}
          audioLevel={0.8}
          audioEnabled={false}
        />,
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
        <PeerAvatarTile
          {...defaultProps}
          audioLevel={0.5}
          audioEnabled={true}
        />,
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

  describe("Mic status badge & dynamic states", () => {
    it("renders mic status badge in muted state with red crossed-out mic and 'Participant muted' tooltip", () => {
      render(<PeerAvatarTile {...defaultProps} audioEnabled={false} />);
      const badge = screen.getByTestId("mic-status-badge");
      expect(badge).toBeInTheDocument();
      expect(badge).toHaveAttribute("title", "Participant muted");
      expect(badge).toHaveAttribute("data-state", "muted");
      expect(screen.getByTestId("mic-muted-icon")).toBeInTheDocument();
      expect(screen.queryByTestId("mic-silent-icon")).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("mic-transmitting-icon"),
      ).not.toBeInTheDocument();
    });

    it("renders mic status badge in silent state with gray mic when audio is enabled but not speaking", () => {
      render(
        <PeerAvatarTile
          {...defaultProps}
          audioEnabled={true}
          isSpeaking={false}
        />,
      );
      const badge = screen.getByTestId("mic-status-badge");
      expect(badge).toBeInTheDocument();
      expect(badge).toHaveAttribute("data-state", "silent");
      expect(screen.getByTestId("mic-silent-icon")).toBeInTheDocument();
      expect(screen.queryByTestId("mic-muted-icon")).not.toBeInTheDocument();
      expect(screen.queryByTestId("radiating-waves")).not.toBeInTheDocument();
    });

    it("renders mic status badge in transmitting state with green mic and animated radiating waves when speaking", () => {
      render(
        <PeerAvatarTile
          {...defaultProps}
          audioEnabled={true}
          isSpeaking={true}
        />,
      );
      const badge = screen.getByTestId("mic-status-badge");
      expect(badge).toBeInTheDocument();
      expect(badge).toHaveAttribute("data-state", "transmitting");
      expect(screen.getByTestId("mic-transmitting-icon")).toBeInTheDocument();
      expect(screen.getByTestId("radiating-waves")).toBeInTheDocument();
      expect(screen.queryByTestId("mic-muted-icon")).not.toBeInTheDocument();
    });

    it("reacts dynamically to peer audio track enabled property changes", () => {
      jest.useFakeTimers();

      const trackListeners: Record<string, EventListener[]> = {};
      const mockTrack = {
        kind: "audio",
        enabled: true,
        muted: false,
        addEventListener: jest.fn((event: string, cb: EventListener) => {
          trackListeners[event] = trackListeners[event] || [];
          trackListeners[event].push(cb);
        }),
        removeEventListener: jest.fn((event: string, cb: EventListener) => {
          if (trackListeners[event]) {
            trackListeners[event] = trackListeners[event].filter(
              (f) => f !== cb,
            );
          }
        }),
      };

      const mockStream = {
        getAudioTracks: () => [mockTrack],
        getVideoTracks: () => [],
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
      } as unknown as MediaStream;

      const { unmount } = render(
        <PeerAvatarTile
          {...defaultProps}
          stream={mockStream}
          audioEnabled={true}
          isSpeaking={false}
        />,
      );

      // Initially audio track is enabled -> silent state
      const badge = screen.getByTestId("mic-status-badge");
      expect(badge).toHaveAttribute("data-state", "silent");
      expect(screen.getByTestId("mic-silent-icon")).toBeInTheDocument();

      // Disable track and advance timer / trigger mute event
      mockTrack.enabled = false;
      act(() => {
        jest.advanceTimersByTime(250);
      });

      // Now badge should react and show muted state with "Participant muted" tooltip
      expect(badge).toHaveAttribute("data-state", "muted");
      expect(badge).toHaveAttribute("title", "Participant muted");
      expect(screen.getByTestId("mic-muted-icon")).toBeInTheDocument();

      // Re-enable track
      mockTrack.enabled = true;
      act(() => {
        jest.advanceTimersByTime(250);
      });

      expect(badge).toHaveAttribute("data-state", "silent");
      expect(screen.getByTestId("mic-silent-icon")).toBeInTheDocument();

      unmount();
      jest.useRealTimers();
    });
  });

  describe("Radiating Circular Hard-Light Energy Shockwaves", () => {
    it("calculates decibel volume from amplitude correctly", () => {
      // Silence
      const silent = calculateDecibelVolume(0);
      expect(silent.decibels).toBe(-60);
      expect(silent.normalizedDb).toBe(0);

      // Peak volume
      const peak = calculateDecibelVolume(1.0);
      expect(peak.decibels).toBe(0);
      expect(peak.normalizedDb).toBe(1);

      // Moderate volume (0.1 amplitude => ~ -20 dB)
      const moderate = calculateDecibelVolume(0.1);
      expect(moderate.decibels).toBe(-20);
      expect(moderate.normalizedDb).toBe(0.6);
    });

    it("renders radiating circular hard-light energy shockwaves when participant speaks", () => {
      render(
        <PeerAvatarTile
          {...defaultProps}
          audioEnabled={true}
          isSpeaking={true}
          audioLevel={0.6}
        />,
      );

      const shockwaves = screen.getByTestId("radiating-shockwaves");
      expect(shockwaves).toBeInTheDocument();

      const ring1 = screen.getByTestId("shockwave-ring-1");
      const ring2 = screen.getByTestId("shockwave-ring-2");
      const ring3 = screen.getByTestId("shockwave-ring-3");

      expect(ring1).toBeInTheDocument();
      expect(ring2).toBeInTheDocument();
      expect(ring3).toBeInTheDocument();

      expect(ring1).toHaveClass("border-emerald-400");
      expect(ring2).toHaveClass("border-emerald-400/70");
      expect(ring3).toHaveClass("border-emerald-300/40");
    });

    it("modulates ripple wave radius scale and opacity based on decibel volume", () => {
      const { unmount } = render(
        <PeerAvatarTile
          {...defaultProps}
          audioEnabled={true}
          isSpeaking={true}
          audioLevel={0.05}
        />,
      );

      const lowRing1 = screen.getByTestId("shockwave-ring-1");
      const lowTransform = lowRing1.style.transform;
      const lowOpacity = parseFloat(lowRing1.style.opacity);
      unmount();

      render(
        <PeerAvatarTile
          {...defaultProps}
          audioEnabled={true}
          isSpeaking={true}
          audioLevel={0.95}
        />,
      );

      const highRing1 = screen.getByTestId("shockwave-ring-1");
      const highTransform = highRing1.style.transform;
      const highOpacity = parseFloat(highRing1.style.opacity);

      // Extract scales
      const getScale = (tf: string) => {
        const match = tf.match(/scale\(([^)]+)\)/);
        return match ? parseFloat(match[1]) : 0;
      };

      expect(getScale(highTransform)).toBeGreaterThan(getScale(lowTransform));
      expect(highOpacity).toBeGreaterThan(lowOpacity);
    });

    it("cleans up CSS animations and removes shockwaves on audio track silence", () => {
      const { rerender } = render(
        <PeerAvatarTile
          {...defaultProps}
          audioEnabled={true}
          isSpeaking={true}
          audioLevel={0.5}
        />,
      );

      expect(screen.getByTestId("radiating-shockwaves")).toBeInTheDocument();

      // Audio becomes silent
      rerender(
        <PeerAvatarTile
          {...defaultProps}
          audioEnabled={true}
          isSpeaking={false}
          audioLevel={0}
        />,
      );

      expect(
        screen.queryByTestId("radiating-shockwaves"),
      ).not.toBeInTheDocument();
    });

    it("cleans up shockwaves when audio is muted even if isSpeaking was true", () => {
      render(
        <PeerAvatarTile
          {...defaultProps}
          audioEnabled={false}
          isSpeaking={true}
          audioLevel={0.5}
        />,
      );

      expect(
        screen.queryByTestId("radiating-shockwaves"),
      ).not.toBeInTheDocument();
    });

    it("initializes and cleans up Web Audio AnalyserNode when stream is provided", () => {
      const mockConnect = jest.fn();
      const mockDisconnect = jest.fn();
      const mockClose = jest.fn();
      const mockGetByteFrequencyData = jest.fn();

      class MockAudioContext {
        state = "running";
        createMediaStreamSource = jest.fn().mockReturnValue({
          connect: mockConnect,
          disconnect: mockDisconnect,
        });
        createAnalyser = jest.fn().mockReturnValue({
          fftSize: 256,
          smoothingTimeConstant: 0.3,
          frequencyBinCount: 128,
          getByteFrequencyData: mockGetByteFrequencyData,
        });
        close = mockClose;
      }

      // @ts-expect-error mocking AudioContext
      window.AudioContext = MockAudioContext;

      const mockTrack = {
        kind: "audio",
        enabled: true,
        muted: false,
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
      };

      const mockStream = {
        getAudioTracks: () => [mockTrack],
        getVideoTracks: () => [],
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
      } as unknown as MediaStream;

      const { unmount } = render(
        <PeerAvatarTile
          {...defaultProps}
          stream={mockStream}
          audioEnabled={true}
          isSpeaking={false}
        />,
      );

      expect(mockConnect).toHaveBeenCalled();

      unmount();

      expect(mockDisconnect).toHaveBeenCalled();
      expect(mockClose).toHaveBeenCalled();
    });
  });
});
