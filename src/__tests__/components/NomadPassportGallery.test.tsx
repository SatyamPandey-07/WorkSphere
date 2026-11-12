import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";

// Mock canvas-confetti
jest.mock("canvas-confetti", () => ({
  __esModule: true,
  default: jest.fn(),
}));

// Mock Three.js / React Three Fiber coin subcomponent
jest.mock("@/components/profile/NomadPassportCoin", () => ({
  __esModule: true,
  default: () => <div data-testid="mock-passport-coin">Coin</div>,
}));

import NomadPassportGallery, { playPoapMintChime } from "@/components/profile/NomadPassportGallery";

describe("NomadPassportGallery Component & playPoapMintChime", () => {
  const mockSetValueAtTime = jest.fn();
  const mockLinearRampToValueAtTime = jest.fn();
  const mockExponentialRampToValueAtTime = jest.fn();
  const mockConnect = jest.fn();
  const mockStart = jest.fn();
  const mockStop = jest.fn();
  const mockClose = jest.fn().mockResolvedValue(undefined);

  class MockAudioContext {
    currentTime = 0;
    state = "running";
    destination = {};

    createOscillator() {
      return {
        type: "sine",
        frequency: { setValueAtTime: mockSetValueAtTime },
        connect: mockConnect,
        start: mockStart,
        stop: mockStop,
      };
    }
    createGain() {
      return {
        gain: {
          setValueAtTime: mockSetValueAtTime,
          linearRampToValueAtTime: mockLinearRampToValueAtTime,
          exponentialRampToValueAtTime: mockExponentialRampToValueAtTime,
        },
        connect: mockConnect,
      };
    }
    close = mockClose;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    (window as any).AudioContext = MockAudioContext;
  });

  afterEach(() => {
    jest.clearAllTimers();
  });

  describe("playPoapMintChime audio envelope synthesis", () => {
    it("synthesizes celebratory arpeggio notes with valid positive volume", () => {
      const res = playPoapMintChime(0.5);
      expect(res).toBe(true);
      expect(mockStart).toHaveBeenCalled();
      expect(mockLinearRampToValueAtTime).toHaveBeenCalled();
      expect(mockExponentialRampToValueAtTime).toHaveBeenCalled();
    });

    it("early exits cleanly without creating audio nodes when volume <= 0", () => {
      const resZero = playPoapMintChime(0);
      expect(resZero).toBe(false);
      expect(mockStart).not.toHaveBeenCalled();

      const resNeg = playPoapMintChime(-0.5);
      expect(resNeg).toBe(false);
      expect(mockStart).not.toHaveBeenCalled();
    });

    it("clamps NaN volume safely and proceeds with fallback", () => {
      const res = playPoapMintChime(NaN);
      expect(res).toBe(true);
      expect(mockStart).toHaveBeenCalled();
    });

    it("returns false when AudioContext is unavailable in window", () => {
      delete (window as any).AudioContext;
      delete (window as any).webkitAudioContext;

      const res = playPoapMintChime(0.5);
      expect(res).toBe(false);
    });
  });

  describe("NomadPassportGallery UI", () => {
    it("renders gallery header and earned stamps section", () => {
      render(<NomadPassportGallery />);

      expect(screen.getByText(/Proof-of-Productivity & Digital Nomad Passport/i)).toBeInTheDocument();
      expect(screen.getByText(/Earned Passport Stamps & Country Badges/i)).toBeInTheDocument();
      expect(screen.getByText(/Portugal Country Stamp/i)).toBeInTheDocument();
      expect(screen.getAllByText(/Second Home Coworking Lisboa/i).length).toBeGreaterThan(0);
    });

    it("toggles celebration audio on and off", () => {
      render(<NomadPassportGallery />);

      const soundBtn = screen.getByTestId("poap-sound-toggle-btn");
      expect(soundBtn).toHaveAttribute("aria-label", "Mute celebratory chime");

      fireEvent.click(soundBtn);
      expect(soundBtn).toHaveAttribute("aria-label", "Enable celebratory chime");
    });

    it("opens stamp inspection modal when clicking Preview button", () => {
      render(<NomadPassportGallery />);

      const previewBtns = screen.getAllByRole("button", { name: /Preview/i });
      fireEvent.click(previewBtns[0]);

      expect(screen.getByTestId("stamp-preview-modal")).toBeInTheDocument();
      expect(screen.getByText(/Passport Stamp Preview/i)).toBeInTheDocument();
    });
  });
});
