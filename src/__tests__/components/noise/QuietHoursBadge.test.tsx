import React from "react";
import { render, screen } from "@testing-library/react";
import {
  QuietHoursBadge,
  QuietHoursBadgeProps,
} from "@/components/noise/QuietHoursBadge";

describe("QuietHoursBadge Component", () => {
  it("renders formatted hour pills sorted in ascending order", () => {
    render(<QuietHoursBadge hours={[14, 9, 21, 6]} />);

    const badge = screen.getByTestId("quiet-hours-badge");
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveAttribute("role", "region");
    expect(badge).toHaveAttribute("aria-label", "Recommended quiet hours");
    expect(screen.getByText("Recommended Quiet Hours:")).toBeInTheDocument();

    const pills = screen.getAllByRole("listitem");
    expect(pills).toHaveLength(4);
    expect(pills[0]).toHaveTextContent("06:00");
    expect(pills[1]).toHaveTextContent("09:00");
    expect(pills[2]).toHaveTextContent("14:00");
    expect(pills[3]).toHaveTextContent("21:00");

    expect(screen.getByTestId("quiet-hours-pill-6")).toBeInTheDocument();
    expect(screen.getByTestId("quiet-hours-pill-9")).toBeInTheDocument();
    expect(screen.getByTestId("quiet-hours-pill-14")).toBeInTheDocument();
    expect(screen.getByTestId("quiet-hours-pill-21")).toBeInTheDocument();
  });

  it("does not mutate the input hours array", () => {
    const inputHours = Object.freeze([18, 8, 12]);
    // If it mutates in place, Object.freeze will throw or fail
    expect(() => {
      render(<QuietHoursBadge hours={inputHours as unknown as number[]} />);
    }).not.toThrow();

    // Verify original order preserved
    expect(inputHours[0]).toBe(18);
    expect(inputHours[1]).toBe(8);
    expect(inputHours[2]).toBe(12);
  });

  it("deduplicates identical hours and renders unique pills", () => {
    render(<QuietHoursBadge hours={[10, 10, 15, 10, 15]} />);

    const pills = screen.getAllByRole("listitem");
    expect(pills).toHaveLength(2);
    expect(pills[0]).toHaveTextContent("10:00");
    expect(pills[1]).toHaveTextContent("15:00");
  });

  it("returns null when hours array is empty", () => {
    const { container } = render(<QuietHoursBadge hours={[]} />);
    expect(container.firstChild).toBeNull();
    expect(screen.queryByTestId("quiet-hours-badge")).not.toBeInTheDocument();
  });

  it("returns null when hours prop is null or undefined without throwing", () => {
    const { container, rerender } = render(<QuietHoursBadge hours={undefined} />);
    expect(container.firstChild).toBeNull();

    rerender(<QuietHoursBadge hours={null as any} />);
    expect(container.firstChild).toBeNull();
  });

  it("filters out invalid hours (negative, > 24, NaN, non-numbers)", () => {
    render(
      <QuietHoursBadge
        hours={[-5, 30, NaN, Infinity, "12" as any, null as any, 7, 22]}
      />,
    );

    const pills = screen.getAllByRole("listitem");
    expect(pills).toHaveLength(2);
    expect(pills[0]).toHaveTextContent("07:00");
    expect(pills[1]).toHaveTextContent("22:00");
  });

  it("returns null when all provided hours are invalid or out of bounds", () => {
    const { container } = render(
      <QuietHoursBadge hours={[-1, 25, 100, NaN]} />,
    );
    expect(container.firstChild).toBeNull();
    expect(screen.queryByTestId("quiet-hours-badge")).not.toBeInTheDocument();
  });

  it("floors decimal hour numbers", () => {
    render(<QuietHoursBadge hours={[8.9, 13.2]} />);

    const pills = screen.getAllByRole("listitem");
    expect(pills).toHaveLength(2);
    expect(pills[0]).toHaveTextContent("08:00");
    expect(pills[1]).toHaveTextContent("13:00");
  });

  it("applies custom className correctly", () => {
    render(<QuietHoursBadge hours={[11]} className="custom-test-class" />);

    const badge = screen.getByTestId("quiet-hours-badge");
    expect(badge).toHaveClass("custom-test-class");
  });
});
