import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import NomadPassportCoin, {
  NomadPassportCoinSkeleton,
} from "@/components/profile/NomadPassportCoin";
import type { PassportStamp } from "@/lib/zkp/nomadProof";

// Mock @react-three/fiber Canvas
jest.mock("@react-three/fiber", () => ({
  Canvas: ({ children, onCreated }: any) => {
    React.useEffect(() => {
      onCreated?.();
    }, [onCreated]);
    return <div data-testid="mock-r3f-canvas">{children}</div>;
  },
  useFrame: jest.fn(),
}));

describe("NomadPassportCoin & NomadPassportCoinSkeleton Component", () => {
  const mockStamp: PassportStamp = {
    stampId: "stamp-test-123",
    venueName: "San Francisco Focus Lounge",
    epoch: 4,
    nullifierHash: "0xabc123def45678901234567890abcdef1234567890abcdef",
    verificationSignature: "zk-sig-valid-stamp",
    countryCode: "US",
  };

  describe("NomadPassportCoinSkeleton", () => {
    it("renders with role='status' and required Tailwind gradient animation classes", () => {
      render(<NomadPassportCoinSkeleton />);

      const skeleton = screen.getByTestId("nomad-coin-skeleton");
      expect(skeleton).toBeInTheDocument();
      expect(skeleton).toHaveAttribute("role", "status");
      expect(skeleton).toHaveClass(
        "bg-gradient-to-r",
        "from-muted",
        "via-muted/50",
        "to-muted",
        "animate-pulse",
      );
    });

    it("maintains coin diameter and circular aspect ratio to prevent layout shift", () => {
      render(<NomadPassportCoinSkeleton />);

      const skeleton = screen.getByTestId("nomad-coin-skeleton");
      expect(skeleton).toHaveClass(
        "rounded-full",
        "aspect-square",
        "w-full",
        "max-w-[20rem]",
      );
    });

    it("includes accessible screen-reader text", () => {
      render(<NomadPassportCoinSkeleton />);

      expect(
        screen.getByText(/loading nomad passport coin/i),
      ).toBeInTheDocument();
    });
  });

  describe("NomadPassportCoin Loading States", () => {
    it("displays shimmer pulse skeleton when isLoading prop is true", () => {
      render(<NomadPassportCoin stamp={mockStamp} isLoading={true} />);

      const skeleton = screen.getByTestId("nomad-coin-skeleton");
      expect(skeleton).toBeInTheDocument();
      expect(skeleton).toHaveClass("animate-pulse");

      const button = screen.getByRole("button");
      expect(button).toHaveClass("opacity-0", "pointer-events-none");
    });

    it("displays shimmer pulse skeleton when isLoaded prop is false", () => {
      render(<NomadPassportCoin stamp={mockStamp} isLoaded={false} />);

      const skeleton = screen.getByTestId("nomad-coin-skeleton");
      expect(skeleton).toBeInTheDocument();
    });

    it("hides skeleton and shows interactive coin button when isLoading is false and isLoaded is true", () => {
      render(
        <NomadPassportCoin
          stamp={mockStamp}
          isLoading={false}
          isLoaded={true}
        />,
      );

      expect(screen.queryByTestId("nomad-coin-skeleton")).not.toBeInTheDocument();

      const button = screen.getByRole("button");
      expect(button).toHaveClass("opacity-100");
      expect(button).not.toHaveClass("pointer-events-none");
    });

    it("calls onReady callback when loading completes", () => {
      const onReadyMock = jest.fn();
      render(
        <NomadPassportCoin
          stamp={mockStamp}
          isLoaded={true}
          onReady={onReadyMock}
        />,
      );

      // Fallback / probe triggers onReady
      expect(onReadyMock).toHaveBeenCalled();
    });

    it("handles flipping interaction on hover and focus", () => {
      render(
        <NomadPassportCoin
          stamp={mockStamp}
          isLoading={false}
          isLoaded={true}
        />,
      );

      const button = screen.getByRole("button");
      expect(button).toHaveAttribute("aria-pressed", "false");

      fireEvent.mouseEnter(button);
      expect(button).toHaveAttribute("aria-pressed", "true");

      fireEvent.mouseLeave(button);
      expect(button).toHaveAttribute("aria-pressed", "false");
    });
  });
});
