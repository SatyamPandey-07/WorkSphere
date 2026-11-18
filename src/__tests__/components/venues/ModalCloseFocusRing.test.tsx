import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { VenueReviewModal } from "@/components/venues/VenueReviewModal";
import { ModalCloseButton } from "@/components/modal/ModalCloseButton";

describe("Modal Close Button High-Contrast Focus Indicators", () => {
  const REQUIRED_FOCUS_CLASSES = [
    "focus-visible:ring-2",
    "focus-visible:ring-primary",
    "focus-visible:ring-offset-2",
    "focus-visible:outline-none",
  ];

  describe("ModalCloseButton Component", () => {
    it("renders with standard high-contrast keyboard focus ring classes", () => {
      const handleClose = jest.fn();
      render(<ModalCloseButton onClick={handleClose} data-testid="test-close-btn" />);

      const closeButton = screen.getByTestId("test-close-btn");
      expect(closeButton).toBeInTheDocument();

      REQUIRED_FOCUS_CLASSES.forEach((cls) => {
        expect(closeButton).toHaveClass(cls);
      });
    });

    it("triggers onClick when clicked", () => {
      const handleClose = jest.fn();
      render(<ModalCloseButton onClick={handleClose} data-testid="test-close-btn" />);

      fireEvent.click(screen.getByTestId("test-close-btn"));
      expect(handleClose).toHaveBeenCalledTimes(1);
    });
  });

  describe("VenueReviewModal Close and Cancel Button Focus Rings", () => {
    it("renders close and cancel buttons with focus-visible ring classes", () => {
      const handleClose = jest.fn();
      render(
        <VenueReviewModal
          isOpen={true}
          onClose={handleClose}
          venueId="test-venue-123"
          venueName="Artisan Cafe"
        />
      );

      const closeButton = screen.getByTestId("venue-review-modal-close");
      const cancelButton = screen.getByTestId("venue-review-cancel-button");

      REQUIRED_FOCUS_CLASSES.forEach((cls) => {
        expect(closeButton).toHaveClass(cls);
        expect(cancelButton).toHaveClass(cls);
      });
    });

    it("restores keyboard focus to opening trigger element on Escape key dismiss", () => {
      const handleClose = jest.fn();
      const trigger = document.createElement("button");
      trigger.id = "open-review-btn";
      document.body.appendChild(trigger);
      trigger.focus();
      expect(document.activeElement).toBe(trigger);

      const { unmount } = render(
        <VenueReviewModal
          isOpen={true}
          onClose={handleClose}
          venueId="test-venue-123"
          venueName="Artisan Cafe"
        />
      );

      fireEvent.keyDown(window, { key: "Escape" });
      expect(handleClose).toHaveBeenCalledTimes(1);

      unmount();
      expect(document.activeElement).toBe(trigger);
      document.body.removeChild(trigger);
    });
  });

  describe("WCAG 1.4.11 Non-Text Contrast Verification", () => {
    function getLuminance(r: number, g: number, b: number): number {
      const a = [r, g, b].map((v) => {
        v /= 255;
        return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
      });
      return a[0] * 0.2126 + a[1] * 0.7152 + a[2] * 0.0722;
    }

    function getContrastRatio(hex1: string, hex2: string): number {
      const parseHex = (hex: string) => {
        const clean = hex.replace("#", "");
        return [
          parseInt(clean.slice(0, 2), 16),
          parseInt(clean.slice(2, 4), 16),
          parseInt(clean.slice(4, 6), 16),
        ];
      };
      const [r1, g1, b1] = parseHex(hex1);
      const [r2, g2, b2] = parseHex(hex2);
      const lum1 = getLuminance(r1, g1, b1);
      const lum2 = getLuminance(r2, g2, b2);
      const brightest = Math.max(lum1, lum2);
      const darkest = Math.min(lum1, lum2);
      return (brightest + 0.05) / (darkest + 0.05);
    }

    it("verifies ring-primary color meets > 3:1 contrast against light and dark backdrops", () => {
      const primaryAccent = "#3b82f6"; // primary blue focus ring
      const lightBackdrop = "#ffffff"; // light mode modal card backdrop
      const darkBackdrop = "#18181b";  // dark mode modal card backdrop (zinc-900)

      const lightContrast = getContrastRatio(primaryAccent, lightBackdrop);
      const darkContrast = getContrastRatio(primaryAccent, darkBackdrop);

      // WCAG 2.1 Non-text contrast minimum requirement is 3.0:1
      expect(lightContrast).toBeGreaterThanOrEqual(3.0);
      expect(darkContrast).toBeGreaterThanOrEqual(3.0);
    });
  });
});
