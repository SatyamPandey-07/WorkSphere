import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { BookingModal } from "@/components/chat/BookingModal";

const mockVenue = {
  id: "venue-1",
  name: "Workspace Alpha",
  category: "Coworking",
  address: "100 Tech Blvd",
  price: 25,
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
});
