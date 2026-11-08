import { render, screen } from "@testing-library/react";
import { BookingStatusBadge } from "@/components/bookings/BookingStatusBadge";

describe("BookingStatusBadge", () => {
  it("renders 'Pending' label for PENDING status", () => {
    render(<BookingStatusBadge status="PENDING" />);
    expect(screen.getByText("Pending")).toBeInTheDocument();
  });

  it("renders 'Confirmed' label for CONFIRMED status", () => {
    render(<BookingStatusBadge status="CONFIRMED" />);
    expect(screen.getByText("Confirmed")).toBeInTheDocument();
  });

  it("renders 'Checked In' label for CHECKED_IN status", () => {
    render(<BookingStatusBadge status="CHECKED_IN" />);
    expect(screen.getByText("Checked In")).toBeInTheDocument();
  });

  it("renders 'Cancelled' label for CANCELLED status", () => {
    render(<BookingStatusBadge status="CANCELLED" />);
    expect(screen.getByText("Cancelled")).toBeInTheDocument();
  });

  it("renders 'Completed' label for COMPLETED status", () => {
    render(<BookingStatusBadge status="COMPLETED" />);
    expect(screen.getByText("Completed")).toBeInTheDocument();
  });

  it("uses amber styling for PENDING", () => {
    const { container } = render(<BookingStatusBadge status="PENDING" />);
    const badge = container.querySelector("span");
    expect(badge!.className).toMatch(/amber/);
  });

  it("uses green styling for CONFIRMED", () => {
    const { container } = render(<BookingStatusBadge status="CONFIRMED" />);
    const badge = container.querySelector("span");
    expect(badge!.className).toMatch(/green/);
  });

  it("uses blue styling for CHECKED_IN", () => {
    const { container } = render(<BookingStatusBadge status="CHECKED_IN" />);
    const badge = container.querySelector("span");
    expect(badge!.className).toMatch(/blue/);
  });

  it("renders an icon by default", () => {
    const { container } = render(<BookingStatusBadge status="CONFIRMED" />);
    expect(container.querySelector("svg")).toBeInTheDocument();
  });

  it("hides icon when showIcon=false", () => {
    const { container } = render(
      <BookingStatusBadge status="CONFIRMED" showIcon={false} />,
    );
    expect(container.querySelector("svg")).toBeNull();
  });

  it("applies custom className", () => {
    const { container } = render(
      <BookingStatusBadge status="PENDING" className="my-custom-class" />,
    );
    expect(container.querySelector("span")!.className).toContain("my-custom-class");
  });
});
