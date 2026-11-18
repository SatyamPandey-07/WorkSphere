import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { useThree } from "@react-three/fiber";

// Mock Three.js for JSDOM test environment
jest.mock("three", () => ({
  CanvasTexture: jest.fn().mockImplementation(() => ({
    colorSpace: "",
    anisotropy: 0,
    dispose: jest.fn(),
  })),
  DoubleSide: 2,
  Group: jest.fn(),
  SRGBColorSpace: "srgb",
}));

// Mock @react-three/fiber Canvas
jest.mock("@react-three/fiber", () => ({
  useThree: jest.fn(),
  Canvas: ({ children, onCreated }: any) => {
    React.useEffect(() => {
      onCreated?.();
    }, [onCreated]);
    return <div data-testid="mock-r3f-canvas">{children}</div>;
  },
  useFrame: jest.fn(),
}));

import NomadPassportCoin, {
  NomadPassportCoinSkeleton,
  PassportCoinResourceCleanup,
  disposePassportCoinResources,
} from "@/components/profile/NomadPassportCoin";
import type { PassportStamp } from "@/lib/zkp/nomadProof";

describe("NomadPassportCoin & NomadPassportCoinSkeleton Component", () => {
  const mockStamp: PassportStamp = {
    stampId: "stamp-test-123",
    venueName: "San Francisco Focus Lounge",
    epoch: 4,
    nullifierHash: "0xabc123def45678901234567890abcdef1234567890abcdef",
    verificationSignature: "zk-sig-valid-stamp",
    countryCode: "US",
  };


  describe("NomadPassportCoin resource disposal", () => {

    it("releases GPU resources when the Canvas cleanup component unmounts", () => {
      const geometry = { dispose: jest.fn() };
      const texture = { isTexture: true, dispose: jest.fn() };
      const material = { map: texture, dispose: jest.fn() };
      const scene = {
        traverse: (callback: (object: any) => void) => {
          callback({ geometry, material });
        },
      };
      const renderer = {
        renderLists: { dispose: jest.fn() },
        dispose: jest.fn(),
      };
      (useThree as unknown as jest.Mock).mockReturnValue({ scene, gl: renderer });

      const view = render(<PassportCoinResourceCleanup />);
      view.unmount();

      expect(geometry.dispose).toHaveBeenCalledTimes(1);
      expect(material.dispose).toHaveBeenCalledTimes(1);
      expect(texture.dispose).toHaveBeenCalledTimes(1);
      expect(renderer.renderLists.dispose).toHaveBeenCalledTimes(1);
      expect(renderer.dispose).toHaveBeenCalledTimes(1);
    });

    it("disposes scene geometries, materials, textures, render lists, and renderer", () => {
      const geometry = { dispose: jest.fn() };
      const texture = { isTexture: true, dispose: jest.fn() };
      const material = { map: texture, dispose: jest.fn() };
      const scene = {
        traverse: (callback: (object: any) => void) => {
          callback({ geometry, material });
          callback({ geometry, material });
        },
      };
      const renderLists = { dispose: jest.fn() };
      const renderer = { renderLists, dispose: jest.fn() };

      disposePassportCoinResources(scene, renderer);

      expect(geometry.dispose).toHaveBeenCalledTimes(1);
      expect(material.dispose).toHaveBeenCalledTimes(1);
      expect(texture.dispose).toHaveBeenCalledTimes(1);
      expect(renderLists.dispose).toHaveBeenCalledTimes(1);
      expect(renderer.dispose).toHaveBeenCalledTimes(1);
    });

    it("disposes each material in a material array", () => {
      const first = { dispose: jest.fn() };
      const second = { dispose: jest.fn() };
      const scene = {
        traverse: (callback: (object: any) => void) => {
          callback({ material: [first, second] });
        },
      };

      disposePassportCoinResources(scene, { dispose: jest.fn() });

      expect(first.dispose).toHaveBeenCalledTimes(1);
      expect(second.dispose).toHaveBeenCalledTimes(1);
    });
  });

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

      expect(
        screen.queryByTestId("nomad-coin-skeleton"),
      ).not.toBeInTheDocument();

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

    it("triggers haptic vibration feedback on hover, focus, and click", () => {
      const vibrateMock = jest.fn().mockReturnValue(true);
      Object.defineProperty(navigator, "vibrate", {
        value: vibrateMock,
        configurable: true,
        writable: true,
      });

      render(
        <NomadPassportCoin
          stamp={mockStamp}
          isLoading={false}
          isLoaded={true}
        />,
      );

      const button = screen.getByRole("button");
      fireEvent.mouseEnter(button);
      expect(vibrateMock).toHaveBeenCalledWith(15);

      vibrateMock.mockClear();
      fireEvent.click(button);
      expect(vibrateMock).toHaveBeenCalledWith([10, 30, 10]);
    });
  });
});
