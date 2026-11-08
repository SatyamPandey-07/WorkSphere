import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { NextOpeningTimeBadge } from "@/components/venue/NextOpeningTimeBadge";

describe("NextOpeningTimeBadge Component", () => {
  it("renders next opening time badge when venue is currently closed before morning opening", () => {
    // 06:15 AM on Oct 8, 2026 (before 8 AM open)
    const testDate = new Date(2026, 9, 8, 6, 15);
    const hours = "08:00 - 20:00";

    render(<NextOpeningTimeBadge hours={hours} nowInput={testDate} />);

    const badge = screen.getByTestId("next-opening-time-badge");
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent("Closed · Opens 8 AM");
    expect(badge).toHaveAttribute(
      "aria-label",
      "Venue operating status: Closed · Opens 8 AM",
    );
  });

  it("renders next opening time badge when venue is currently closed in evening (opens tomorrow)", () => {
    // 21:30 PM on Oct 8, 2026 (after 8 PM close)
    const testDate = new Date(2026, 9, 8, 21, 30);
    const hours = "08:00 - 20:00";

    render(<NextOpeningTimeBadge hours={hours} nowInput={testDate} />);

    const badge = screen.getByTestId("next-opening-time-badge");
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent("Closed · Opens 8 AM tomorrow");
  });

  it("renders open status when venue is currently open", () => {
    // 14:30 (2:30 PM) on Oct 8, 2026
    const testDate = new Date(2026, 9, 8, 14, 30);
    const hours = "08:00 - 20:00";

    render(<NextOpeningTimeBadge hours={hours} nowInput={testDate} />);

    const badge = screen.getByTestId("next-opening-time-badge");
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent("Open Now · Closes 8 PM");
  });

  it("respects closedOnly prop to hide badge when venue is currently open", () => {
    const testDate = new Date(2026, 9, 8, 14, 30);
    const hours = "08:00 - 20:00";

    const { container } = render(
      <NextOpeningTimeBadge hours={hours} nowInput={testDate} closedOnly={true} />,
    );

    expect(container.firstChild).toBeNull();
  });

  it("handles structured weekly JSON with next day name when closed on weekend", () => {
    const weeklySchedule = JSON.stringify({
      periods: {
        monday: { open: "08:00", close: "18:00", closed: false },
        tuesday: { open: "08:00", close: "18:00", closed: false },
        wednesday: { open: "08:00", close: "18:00", closed: false },
        thursday: { open: "08:00", close: "18:00", closed: false },
        friday: { open: "08:00", close: "18:00", closed: false },
        saturday: { open: "10:00", close: "16:00", closed: false },
        sunday: { open: "00:00", close: "00:00", closed: true },
      },
    });

    // Sunday Oct 11, 2026 at 14:00 (closed Sunday, opens Monday)
    const sundayAfternoon = new Date(2026, 9, 11, 14, 0);

    render(
      <NextOpeningTimeBadge
        hours={weeklySchedule}
        nowInput={sundayAfternoon}
      />,
    );

    const badge = screen.getByTestId("next-opening-time-badge");
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent("Closed · Opens 8 AM Monday");
  });

  it("returns null for empty or missing hours", () => {
    const { container: container1 } = render(<NextOpeningTimeBadge hours={null} />);
    expect(container1.firstChild).toBeNull();

    const { container: container2 } = render(<NextOpeningTimeBadge hours="" />);
    expect(container2.firstChild).toBeNull();

    const { container: container3 } = render(
      <NextOpeningTimeBadge hours={undefined} />,
    );
    expect(container3.firstChild).toBeNull();
  });
});
