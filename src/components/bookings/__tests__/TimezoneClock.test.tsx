import React from "react";
import { render, screen } from "@testing-library/react";
import { TimezoneClock } from "../TimezoneClock";

describe("TimezoneClock", () => {
  beforeAll(() => {
    jest.useFakeTimers();
    // Set a fixed system time so tests are deterministic.
    // Oct 15, 2023 at 12:00:00 UTC
    jest.setSystemTime(new Date("2023-10-15T12:00:00Z"));
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  it("renders correctly for EST/EDT (America/New_York)", () => {
    render(<TimezoneClock timeZone="America/New_York" />);
    // 12:00:00Z is 08:00:00 AM EDT (in Oct, daylight saving time is active)
    expect(screen.getByText(/08:00:00\s*AM/)).toBeInTheDocument();
    expect(screen.getByText("EDT")).toBeInTheDocument();
  });

  it("renders correctly for PST/PDT (America/Los_Angeles)", () => {
    render(<TimezoneClock timeZone="America/Los_Angeles" />);
    // 12:00:00Z is 05:00:00 AM PDT
    expect(screen.getByText(/05:00:00\s*AM/)).toBeInTheDocument();
    expect(screen.getByText("PDT")).toBeInTheDocument();
  });

  it("renders correctly for JST (Asia/Tokyo)", () => {
    render(<TimezoneClock timeZone="Asia/Tokyo" />);
    // 12:00:00Z is 09:00:00 PM JST
    expect(screen.getByText(/09:00:00\s*PM/)).toBeInTheDocument();
    expect(screen.getByText("JST")).toBeInTheDocument();
  });

  it("renders correctly for UTC", () => {
    render(<TimezoneClock timeZone="UTC" />);
    expect(screen.getByText(/12:00:00\s*PM/)).toBeInTheDocument();
    expect(screen.getByText("UTC")).toBeInTheDocument();
  });

  it("handles invalid timezone identifiers gracefully", () => {
    render(<TimezoneClock timeZone="Invalid/Timezone" />);
    expect(screen.getByText("--:--:-- --")).toBeInTheDocument();
    expect(screen.getByText("Invalid/Timezone")).toBeInTheDocument();
  });
});

