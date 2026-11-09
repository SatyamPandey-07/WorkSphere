import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import {
  CheckInModal,
  sanitizeCheckInCode,
  sanitizeCouponCode,
} from "@/components/CheckInModal";

jest.mock("canvas-confetti", () => jest.fn());

describe("CheckInModal Component & Input Sanitation", () => {
  describe("Sanitization Helpers", () => {
    it("trims whitespace and converts check-in codes to uppercase", () => {
      expect(sanitizeCheckInCode("  ws-pass-123  ")).toBe("WS-PASS-123");
      expect(sanitizeCheckInCode("   desk42   ")).toBe("DESK42");
      expect(sanitizeCheckInCode("   ")).toBe("");
      expect(sanitizeCheckInCode("")).toBe("");
    });

    it("trims whitespace and converts coupon codes to uppercase", () => {
      expect(sanitizeCouponCode("   summer50   ")).toBe("SUMMER50");
      expect(sanitizeCouponCode("  work_pro_2026  ")).toBe("WORK_PRO_2026");
      expect(sanitizeCouponCode("   ")).toBe("");
    });
  });

  describe("CheckInModal Interactions", () => {
    it("does not render when isOpen is false", () => {
      const { container } = render(
        <CheckInModal isOpen={false} onClose={jest.fn()} />,
      );
      expect(container.firstChild).toBeNull();
    });

    it("trims whitespace and uppercases code on form submission", async () => {
      const handleCheckIn = jest.fn().mockResolvedValue(undefined);
      render(
        <CheckInModal
          isOpen={true}
          onClose={jest.fn()}
          onCheckIn={handleCheckIn}
          venueName="Downtown Innovation Lab"
        />,
      );

      const codeInput = screen.getByTestId("checkin-code-input");
      const couponInput = screen.getByTestId("coupon-code-input");
      const submitBtn = screen.getByTestId("checkin-submit-btn");

      fireEvent.change(codeInput, { target: { value: "   ws-seat-999   " } });
      fireEvent.change(couponInput, { target: { value: "   save10   " } });
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(handleCheckIn).toHaveBeenCalledWith({
          code: "WS-SEAT-999",
          couponCode: "SAVE10",
        });
      });
    });

    it("displays clean validation error if submitted input consists purely of spaces", async () => {
      const handleCheckIn = jest.fn();
      render(
        <CheckInModal
          isOpen={true}
          onClose={jest.fn()}
          onCheckIn={handleCheckIn}
        />,
      );

      const codeInput = screen.getByTestId("checkin-code-input");
      const submitBtn = screen.getByTestId("checkin-submit-btn");

      // Enter pure whitespace
      fireEvent.change(codeInput, { target: { value: "     " } });
      fireEvent.click(submitBtn);

      const errorBanner = await screen.findByTestId("checkin-validation-error");
      expect(errorBanner).toBeInTheDocument();
      expect(errorBanner).toHaveTextContent("Please enter a valid check-in code.");
      expect(handleCheckIn).not.toHaveBeenCalled();
    });

    it("closes modal on cancel button or close X click", () => {
      const handleClose = jest.fn();
      render(<CheckInModal isOpen={true} onClose={handleClose} />);

      const closeBtn = screen.getByTestId("checkin-modal-close");
      fireEvent.click(closeBtn);
      expect(handleClose).toHaveBeenCalledTimes(1);

      const cancelBtn = screen.getByRole("button", { name: "Cancel" });
      fireEvent.click(cancelBtn);
      expect(handleClose).toHaveBeenCalledTimes(2);
    });

    it("disables confirm button and shows 'Acquiring location...' while geolocation check is pending", () => {
      render(
        <CheckInModal
          isOpen={true}
          onClose={jest.fn()}
          isLocating={true}
        />
      );

      const submitBtn = screen.getByTestId("checkin-submit-btn");
      expect(submitBtn).toBeDisabled();
      expect(submitBtn).toHaveTextContent("Acquiring location...");
    });

    it("triggers confetti animation and displays streak banner upon successful check-in", async () => {
      const handleCheckIn = jest.fn().mockResolvedValue({ currentStreak: 5 });
      const handleClose = jest.fn();

      render(
        <CheckInModal
          isOpen={true}
          onClose={handleClose}
          onCheckIn={handleCheckIn}
          currentStreak={4}
          venueName="Artisan Roastery"
        />
      );

      const codeInput = screen.getByTestId("checkin-code-input");
      const submitBtn = screen.getByTestId("checkin-submit-btn");

      fireEvent.change(codeInput, { target: { value: "WS-VALID-123" } });
      fireEvent.click(submitBtn);

      // Check success view appears
      const successView = await screen.findByTestId("checkin-success-view");
      expect(successView).toBeInTheDocument();
      expect(screen.getByText(/Check-In Successful!/i)).toBeInTheDocument();

      // Check streak banner
      const streakBanner = await screen.findByTestId("checkin-streak-banner");
      expect(streakBanner).toBeInTheDocument();
      expect(streakBanner).toHaveTextContent("5 Day Check-In Streak!");
    });
  });
});
