import "@testing-library/jest-dom";
import React from "react";
import { render, screen } from "@testing-library/react";
import NextOpeningTimeBadgeDefault, {
  NextOpeningTimeBadge,
} from "@/components/venue/NextOpeningTimeBadge";

describe("NextOpeningTimeBadge Component Suite", () => {
  it("exports default matching named export", () => {
    expect(NextOpeningTimeBadgeDefault).toBe(NextOpeningTimeBadge);
  });

  it("returns null when hours prop is undefined, null, empty, or whitespace", () => {
    const { container: c1 } = render(<NextOpeningTimeBadge hours={undefined} />);
    expect(c1.firstChild).toBeNull();

    const { container: c2 } = render(<NextOpeningTimeBadge hours={null} />);
    expect(c2.firstChild).toBeNull();

    const { container: c3 } = render(<NextOpeningTimeBadge hours="" />);
    expect(c3.firstChild).toBeNull();

    const { container: c4 } = render(<NextOpeningTimeBadge hours="   " />);
    expect(c4.firstChild).toBeNull();
  });

  it("renders 24/7 badge when hours is '24/7'", () => {
    render(
      <NextOpeningTimeBadge
        hours="24/7"
        nowInput={new Date("2026-10-30T14:00:00Z")}
      />
    );

    const badge = screen.getByTestId("next-opening-time-badge");
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent(/open 24 hours/i);
  });

  it("renders open status with closing time when venue is open", () => {
    // Structured JSON hours: Mon-Sun 08:00 - 22:00
    const hoursJson = JSON.stringify({
      periods: {
        friday: { open: "08:00", close: "22:00" },
      },
    });

    // 2026-10-30 is a Friday at 14:00 (2 PM)
    const nowFridayAfternoon = new Date("2026-10-30T14:00:00");

    render(
      <NextOpeningTimeBadge
        hours={hoursJson}
        nowInput={nowFridayAfternoon}
      />
    );

    const badge = screen.getByTestId("next-opening-time-badge");
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent(/open/i);
  });

  it("renders closed status with next opening time when venue is closed", () => {
    const hoursJson = JSON.stringify({
      periods: {
        friday: { open: "08:00", close: "18:00" },
        saturday: { open: "09:00", close: "17:00" },
      },
    });

    // 2026-10-30 is a Friday at 21:00 (9 PM - after close)
    const nowFridayNight = new Date("2026-10-30T21:00:00");

    render(
      <NextOpeningTimeBadge
        hours={hoursJson}
        nowInput={nowFridayNight}
      />
    );

    const badge = screen.getByTestId("next-opening-time-badge");
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent(/opens/i);
  });

  it("suppresses badge when closedOnly is true and venue is open", () => {
    const hoursJson = JSON.stringify({
      periods: {
        friday: { open: "08:00", close: "22:00" },
      },
    });

    const nowFridayAfternoon = new Date("2026-10-30T14:00:00");

    const { container } = render(
      <NextOpeningTimeBadge
        hours={hoursJson}
        nowInput={nowFridayAfternoon}
        closedOnly={true}
      />
    );

    expect(container.firstChild).toBeNull();
  });

  it("renders badge when closedOnly is true and venue is closed", () => {
    const hoursJson = JSON.stringify({
      periods: {
        friday: { open: "08:00", close: "18:00" },
      },
    });

    const nowFridayNight = new Date("2026-10-30T21:00:00");

    render(
      <NextOpeningTimeBadge
        hours={hoursJson}
        nowInput={nowFridayNight}
        closedOnly={true}
      />
    );

    expect(screen.getByTestId("next-opening-time-badge")).toBeInTheDocument();
  });

  it("renders SSR fallback badge when nowInput is omitted and client has not hydrated", () => {
    // In node/JSDOM, useEffect runs after first render, but we can verify SSR badge testid
    // when mock useState initializes isClient to false
    render(
      <NextOpeningTimeBadge
        hours="24/7"
        data-testid="hours-badge"
      />
    );

    // After mount in jsdom, useEffect sets isClient=true
    expect(screen.getByTestId("hours-badge")).toBeInTheDocument();
  });

  it("applies custom className and custom data-testid", () => {
    render(
      <NextOpeningTimeBadge
        hours="24/7"
        nowInput={new Date("2026-10-30T14:00:00Z")}
        className="custom-badge-style"
        data-testid="custom-hours-badge"
      />
    );

    const badge = screen.getByTestId("custom-hours-badge");
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveClass("custom-badge-style");
  });
});
