import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";

// Mock canvas-confetti
jest.mock("canvas-confetti", () => ({
  __esModule: true,
  default: jest.fn(),
}));

// Mock nomadProofClient for JSDOM test environment
jest.mock("@/lib/zkp/nomadProofClient", () => ({
  generateClientNomadProof: jest.fn(),
}));

// Mock Three.js / React Three Fiber coin subcomponent
jest.mock("@/components/profile/NomadPassportCoin", () => ({
  __esModule: true,
  default: () => <div data-testid="mock-passport-coin">Coin</div>,
}));

import NomadPassportGallery, {
  playPoapMintChime,
} from "@/components/profile/NomadPassportGallery";

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
    global.fetch = jest.fn().mockImplementation(() =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            valid: true,
            status: "verified",
            signatureFingerprint: "mocked...fingerprint",
            timestamp: "2024-03-01T12:00:00Z",
          }),
      }),
    );
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

      expect(
        screen.getByText(/Proof-of-Productivity & Digital Nomad Passport/i),
      ).toBeInTheDocument();
      expect(
        screen.getByText(/Earned Passport Stamps & Country Badges/i),
      ).toBeInTheDocument();
      expect(screen.getByText(/Portugal Country Stamp/i)).toBeInTheDocument();
      expect(
        screen.getAllByText(/Second Home Coworking Lisboa/i).length,
      ).toBeGreaterThan(0);
    });

    it("toggles celebration audio on and off", () => {
      render(<NomadPassportGallery />);

      const soundBtn = screen.getByTestId("poap-sound-toggle-btn");
      expect(soundBtn).toHaveAttribute("aria-label", "Mute celebratory chime");

      fireEvent.click(soundBtn);
      expect(soundBtn).toHaveAttribute(
        "aria-label",
        "Enable celebratory chime",
      );
    });

    it("opens stamp inspection modal when clicking Preview button", () => {
      render(<NomadPassportGallery />);

      const previewBtns = screen.getAllByRole("button", { name: /Preview/i });
      fireEvent.click(previewBtns[0]);

      expect(screen.getByTestId("stamp-preview-modal")).toBeInTheDocument();
      expect(screen.getByText(/Passport Stamp Preview/i)).toBeInTheDocument();
    });

    describe("Stamp Preview Modal Scrolling & Accessibility (Issue #9160)", () => {
      it("establishes a single scroll container with overflow-y-auto, overflow-x-hidden, and max-h-[90vh]", () => {
        render(<NomadPassportGallery />);

        const previewBtns = screen.getAllByRole("button", { name: /Preview/i });
        fireEvent.click(previewBtns[0]);

        const outerDialog = screen.getByTestId("stamp-preview-modal");
        expect(outerDialog).toBeInTheDocument();
        expect(outerDialog).toHaveClass("overflow-hidden");
        expect(outerDialog).not.toHaveClass("overflow-y-auto");

        const innerContent = outerDialog.firstElementChild as HTMLElement;
        expect(innerContent).toBeInTheDocument();
        expect(innerContent).toHaveClass("overflow-y-auto");
        expect(innerContent).toHaveClass("overflow-x-hidden");
        expect(innerContent).toHaveClass("max-h-[90vh]");
      });

      it("closes modal on Escape key press", () => {
        render(<NomadPassportGallery />);

        const previewBtns = screen.getAllByRole("button", { name: /Preview/i });
        fireEvent.click(previewBtns[0]);

        expect(screen.getByTestId("stamp-preview-modal")).toBeInTheDocument();

        fireEvent.keyDown(window, { key: "Escape" });

        expect(screen.queryByTestId("stamp-preview-modal")).not.toBeInTheDocument();
      });

      it("closes modal on backdrop click and close button click", () => {
        render(<NomadPassportGallery />);

        const previewBtns = screen.getAllByRole("button", { name: /Preview/i });
        fireEvent.click(previewBtns[0]);

        const closeBtn = screen.getByRole("button", { name: /close modal/i });
        fireEvent.click(closeBtn);

        expect(screen.queryByTestId("stamp-preview-modal")).not.toBeInTheDocument();

        // Reopen and test backdrop click
        fireEvent.click(previewBtns[0]);
        const backdrop = screen.getByTestId("stamp-preview-modal");
        fireEvent.click(backdrop);

        expect(screen.queryByTestId("stamp-preview-modal")).not.toBeInTheDocument();
      });
    });
  });
});
