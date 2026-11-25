import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { BookingModal } from "@/components/bookings/BookingModal";
import { getDatePreset } from "@/lib/validations/dateFilter";

describe("BookingModal Date Presets (#9608)", () => {
  const defaultProps = {
    venueId: "test-venue-1",
    venueName: "Test Venue",
    onClose: jest.fn(),
    onSuccess: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders Today, Tomorrow, and This Weekend preset buttons", () => {
    render(<BookingModal {...defaultProps} />);

    expect(screen.getByTestId("date-preset-today")).toBeInTheDocument();
    expect(screen.getByTestId("date-preset-tomorrow")).toBeInTheDocument();
    expect(screen.getByTestId("date-preset-weekend")).toBeInTheDocument();

    expect(screen.getByTestId("date-preset-today")).toHaveTextContent("Today");
    expect(screen.getByTestId("date-preset-tomorrow")).toHaveTextContent("Tomorrow");
    expect(screen.getByTestId("date-preset-weekend")).toHaveTextContent("This Weekend");
  });

  it("updates date input and highlights active preset when Today is clicked", () => {
    render(<BookingModal {...defaultProps} />);

    const dateInput = screen.getByLabelText("Date") as HTMLInputElement;
    const todayBtn = screen.getByTestId("date-preset-today");

    expect(dateInput.value).toBe("");

    fireEvent.click(todayBtn);

    const { startDate } = getDatePreset("today");
    expect(dateInput.value).toBe(startDate);
    expect(todayBtn).toHaveClass("bg-violet-600");
  });

  it("updates date input and highlights active preset when Tomorrow is clicked", () => {
    render(<BookingModal {...defaultProps} />);

    const dateInput = screen.getByLabelText("Date") as HTMLInputElement;
    const tomorrowBtn = screen.getByTestId("date-preset-tomorrow");

    fireEvent.click(tomorrowBtn);

    const { startDate } = getDatePreset("tomorrow");
    expect(dateInput.value).toBe(startDate);
    expect(tomorrowBtn).toHaveClass("bg-violet-600");
    expect(screen.getByTestId("date-preset-today")).not.toHaveClass("bg-violet-600");
  });

  it("updates date input and highlights active preset when This Weekend is clicked", () => {
    render(<BookingModal {...defaultProps} />);

    const dateInput = screen.getByLabelText("Date") as HTMLInputElement;
    const weekendBtn = screen.getByTestId("date-preset-weekend");

    fireEvent.click(weekendBtn);

    const { startDate } = getDatePreset("weekend");
    expect(dateInput.value).toBe(startDate);
    expect(weekendBtn).toHaveClass("bg-violet-600");
  });

  it("clears the active preset highlight when date is changed manually to a different date", () => {
    render(<BookingModal {...defaultProps} />);

    const dateInput = screen.getByLabelText("Date") as HTMLInputElement;
    const todayBtn = screen.getByTestId("date-preset-today");

    fireEvent.click(todayBtn);
    expect(todayBtn).toHaveClass("bg-violet-600");

    // Manually change the date input to a different date
    fireEvent.change(dateInput, { target: { value: "2099-12-31" } });

    expect(dateInput.value).toBe("2099-12-31");
    expect(todayBtn).not.toHaveClass("bg-violet-600");
  });

  it("retains active preset highlight when manually setting same date as preset", () => {
    render(<BookingModal {...defaultProps} />);

    const dateInput = screen.getByLabelText("Date") as HTMLInputElement;
    const todayBtn = screen.getByTestId("date-preset-today");

    fireEvent.click(todayBtn);
    expect(todayBtn).toHaveClass("bg-violet-600");

    const { startDate } = getDatePreset("today");
    fireEvent.change(dateInput, { target: { value: startDate } });

    expect(todayBtn).toHaveClass("bg-violet-600");
  });
});
