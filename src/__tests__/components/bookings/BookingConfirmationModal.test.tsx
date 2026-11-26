import React from "react";
import {
  render,
  screen,
  fireEvent,
  act,
  waitFor,
} from "@testing-library/react";
import { BookingConfirmationModal } from "@/components/bookings/BookingConfirmationModal";
import { BookingModal } from "@/components/bookings/BookingModal";

describe("BookingConfirmationModal - Double-click and submission guard", () => {
  it("disables submit button and shows spinner immediately upon submit", async () => {
    let resolveConfirm!: () => void;
    const pendingPromise = new Promise<void>((resolve) => {
      resolveConfirm = resolve;
    });
    const onConfirm = jest.fn(() => pendingPromise);
    const onClose = jest.fn();

    render(
      <BookingConfirmationModal
        isOpen
        onClose={onClose}
        onConfirm={onConfirm}
        venueName="Creative Nomad Studio"
      />,
    );

    const submitBtn = screen.getByRole("button", {
      name: /confirm reservation/i,
    });
    expect(submitBtn).not.toBeDisabled();
    expect(
      screen.queryByTestId("booking-confirm-spinner"),
    ).not.toBeInTheDocument();

    // Click confirm
    await act(async () => {
      fireEvent.click(submitBtn);
    });

    // Button should immediately enter a disabled/loading state
    expect(submitBtn).toBeDisabled();
    expect(submitBtn).toHaveAttribute("aria-busy", "true");
    expect(screen.getByTestId("booking-confirm-spinner")).toBeInTheDocument();
    expect(screen.getByText("Booking...")).toBeInTheDocument();
    expect(onConfirm).toHaveBeenCalledTimes(1);

    // Resolve submission
    await act(async () => {
      resolveConfirm();
      await pendingPromise;
    });

    await waitFor(() => {
      expect(submitBtn).not.toBeDisabled();
      expect(
        screen.queryByTestId("booking-confirm-spinner"),
      ).not.toBeInTheDocument();
    });
  });

  it("ignores subsequent clicks while isSubmitting is true (rapid double-click prevention)", async () => {
    let resolveConfirm!: () => void;
    const pendingPromise = new Promise<void>((resolve) => {
      resolveConfirm = resolve;
    });
    const onConfirm = jest.fn(() => pendingPromise);
    const onClose = jest.fn();

    render(
      <BookingConfirmationModal
        isOpen
        onClose={onClose}
        onConfirm={onConfirm}
      />,
    );

    const submitBtn = screen.getByRole("button", {
      name: /confirm reservation/i,
    });

    // Rapidly double-click or triple-click the submit button
    await act(async () => {
      fireEvent.click(submitBtn);
      fireEvent.click(submitBtn);
      fireEvent.click(submitBtn);
    });

    // Only one dispatch should occur
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(submitBtn).toBeDisabled();

    // Complete the pending request
    await act(async () => {
      resolveConfirm();
      await pendingPromise;
    });

    await waitFor(() => {
      expect(submitBtn).not.toBeDisabled();
    });
  });

  it("re-enables button if the API returns an error so the user can retry", async () => {
    let rejectConfirm!: (reason?: unknown) => void;
    const rejectedPromise = new Promise<void>((_, reject) => {
      rejectConfirm = reject;
    });
    const onConfirm = jest
      .fn()
      .mockImplementationOnce(() => rejectedPromise)
      .mockImplementationOnce(() => Promise.resolve());
    const onError = jest.fn();
    const onClose = jest.fn();

    render(
      <BookingConfirmationModal
        isOpen
        onClose={onClose}
        onConfirm={onConfirm}
        onError={onError}
      />,
    );

    const submitBtn = screen.getByRole("button", {
      name: /confirm reservation/i,
    });
    await act(async () => {
      fireEvent.click(submitBtn);
    });

    expect(submitBtn).toBeDisabled();
    expect(screen.getByTestId("booking-confirm-spinner")).toBeInTheDocument();

    // Simulate API rejection / network error
    await act(async () => {
      rejectConfirm(new Error("Seat already reserved by another user"));
      try {
        await rejectedPromise;
      } catch {
        // Expected rejection
      }
    });

    // Button should be re-enabled for retry
    await waitFor(() => {
      expect(submitBtn).not.toBeDisabled();
      expect(
        screen.queryByTestId("booking-confirm-spinner"),
      ).not.toBeInTheDocument();
    });
    expect(onError).toHaveBeenCalledWith(expect.any(Error));

    // User corrects and retries submission successfully
    await act(async () => {
      fireEvent.click(submitBtn);
    });
    expect(onConfirm).toHaveBeenCalledTimes(2);
  });

  it("asserts button is disabled during pending submission via isSubmitting prop", () => {
    render(
      <BookingModal
        isOpen
        isSubmitting={true}
        onClose={() => {}}
        onConfirm={jest.fn()}
      />,
    );

    const submitBtn = screen.getByRole("button", { name: /booking\.\.\./i });
    expect(submitBtn).toBeDisabled();
    expect(screen.getByTestId("booking-confirm-spinner")).toBeInTheDocument();
  });
});
