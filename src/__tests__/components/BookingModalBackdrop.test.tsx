import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { BookingModal } from "@/components/chat/BookingModal";

const mockVenue = {
  id: "venue-1",
  name: "Workspace Alpha",
  category: "Coworking",
  address: "100 Tech Blvd",
  price: 25,
  lat: 0,
  lng: 0,
};

describe("BookingModal Backdrop & Input Propagation (#1749)", () => {
  it("does not dismiss the modal when clicking input fields inside the modal container", () => {
    const handleClose = jest.fn();

    render(
      <BookingModal venue={mockVenue} isOpen={true} onClose={handleClose} />,
    );

    const emailInput = screen.getByPlaceholderText("you@example.com");
    expect(emailInput).toBeInTheDocument();

    // Click on input field
    fireEvent.pointerDown(emailInput);
    fireEvent.click(emailInput);

    expect(handleClose).not.toHaveBeenCalled();
  });

  it("dismisses the modal when clicking directly on the backdrop", () => {
    const handleClose = jest.fn();

    const { container } = render(
      <BookingModal venue={mockVenue} isOpen={true} onClose={handleClose} />,
    );

    const backdrop = container.firstElementChild as HTMLElement;

    // Click directly on backdrop
    fireEvent.pointerDown(backdrop);
    fireEvent.click(backdrop);

    expect(handleClose).toHaveBeenCalledTimes(1);
  });

  it("does not dismiss the modal on backdrop click or Escape when booking submission is in progress", async () => {
    const handleClose = jest.fn();
    const originalFetch = global.fetch;
    let resolvePromise: (value: any) => void;
    global.fetch = jest.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePromise = resolve;
        }),
    );

    const { container } = render(
      <BookingModal venue={mockVenue} isOpen={true} onClose={handleClose} />,
    );

    const dateInput = screen.getByLabelText("Date");
    const startTimeInput = screen.getByTestId("booking-start-time");
    const emailInput = screen.getByPlaceholderText("you@example.com");
    const submitBtn = screen.getByRole("button", { name: /confirm booking/i });

    fireEvent.change(dateInput, { target: { value: "2026-10-10" } });
    fireEvent.change(startTimeInput, { target: { value: "10:00" } });
    fireEvent.change(emailInput, { target: { value: "user@example.com" } });

    // Submit booking
    fireEvent.click(submitBtn);

    const backdrop = container.firstElementChild as HTMLElement;

    // Attempt backdrop click while submitting
    fireEvent.pointerDown(backdrop);
    fireEvent.click(backdrop);
    expect(handleClose).not.toHaveBeenCalled();

    // Attempt Escape key while submitting
    fireEvent.keyDown(document, { key: "Escape" });
    expect(handleClose).not.toHaveBeenCalled();

    // Resolve fetch
    resolvePromise!({
      ok: true,
      json: async () => ({ confirmationId: "conf-1" }),
    });

    global.fetch = originalFetch;
  });
});
