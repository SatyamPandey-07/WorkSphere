import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { BookingHistoryList } from "@/app/dashboard/BookingHistoryList";
import { BookingSummary } from "@/components/bookings/BookingList";

const generateMockBookings = (count: number): BookingSummary[] => {
  return Array.from({ length: count }, (_, i) => ({
    id: `booking-${i + 1}`,
    confirmationId: `WS-CONF-${1000 + i}`,
    date: "2026-11-15",
    time: "10:00",
    status: i % 3 === 0 ? "CONFIRMED" : i % 3 === 1 ? "CANCELLED" : "CONFIRMED",
    seatNumber: `${i + 1}A`,
    duration: 120,
    createdAt: new Date().toISOString(),
    venue: {
      name: `Workspace Hub ${i + 1}`,
      category: "coworking_space",
      address: `${100 + i} Innovation Way`,
    },
  }));
};

describe("BookingHistoryList Virtualization (#3772)", () => {
  beforeAll(() => {
    // Mock ResizeObserver
    global.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  });

  it("renders virtualized subset of items plus overscan buffer instead of entire collection", () => {
    const mockBookings = generateMockBookings(100);
    render(<BookingHistoryList bookings={mockBookings} itemHeight={120} />);

    // Viewport exists
    const viewport = screen.getByTestId("virtualized-booking-viewport");
    expect(viewport).toBeInTheDocument();

    // The number of rendered cards in DOM should be bounded (~10-20 items), far less than 100
    const renderedCards = screen.getAllByTestId("virtual-booking-card");
    expect(renderedCards.length).toBeLessThan(25);
    expect(renderedCards.length).toBeGreaterThan(0);
  });

  it("filters bookings by search query while maintaining virtualization", () => {
    const mockBookings = generateMockBookings(50);
    render(<BookingHistoryList bookings={mockBookings} />);

    const searchInput = screen.getByPlaceholderText(/search venue name/i);
    fireEvent.change(searchInput, { target: { value: "Workspace Hub 5" } });

    // Should find matches for Hub 5, Hub 50, etc.
    expect(screen.getByText("Workspace Hub 5")).toBeInTheDocument();
  });

  it("filters bookings by status tab", () => {
    const mockBookings = generateMockBookings(30);
    render(<BookingHistoryList bookings={mockBookings} />);

    const cancelledTab = screen.getByRole("button", { name: "Cancelled" });
    fireEvent.click(cancelledTab);

    const renderedCards = screen.getAllByTestId("virtual-booking-card");
    expect(renderedCards.length).toBeGreaterThan(0);
    expect(screen.getAllByText("Cancelled")[0]).toBeInTheDocument();
  });
});
