import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import {
  CoworkingSessionCard,
  CoworkingSessionCardProps,
} from "@/components/cowork/CoworkingSessionCard";
import * as icsGenerator from "@/lib/calendar/icsGenerator";

const baseSession: CoworkingSessionCardProps["session"] = {
  id: "session-123",
  title: "Morning Deep Work",
  description: "Silent coworking block for engineers and designers.",
  location: "Downtown Innovation Hub",
  hostName: "Alice Chen",
  attendeeCount: 14,
  startTime: new Date("2026-11-25T09:00:00Z"),
  endTime: new Date("2026-11-25T12:00:00Z"),
};

describe("CoworkingSessionCard live pulse indicator (Issue #7373)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders live double-circle pulse indicator when status is 'LIVE'", () => {
    render(
      <CoworkingSessionCard session={{ ...baseSession, status: "LIVE" }} />,
    );

    const badge = screen.getByTestId("session-status-badge");
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent("Live Coworking Session");

    const pulseContainer = screen.getByTestId("live-pulse-indicator");
    expect(pulseContainer).toBeInTheDocument();
    expect(pulseContainer).toHaveAttribute("aria-hidden", "true");
    expect(pulseContainer).toHaveClass("pointer-events-none");

    const pingCircle = pulseContainer.querySelector(".animate-ping");
    expect(pingCircle).toBeInTheDocument();
    expect(pingCircle).toHaveClass("animate-ping");
    expect(pingCircle).toHaveClass("bg-emerald-400");
    expect(pingCircle).toHaveClass("opacity-75");
    expect(pingCircle).toHaveClass("motion-reduce:animate-none");
    expect(pingCircle).toHaveClass("rounded-full");

    const solidInnerDot = pulseContainer.querySelector(".bg-emerald-500");
    expect(solidInnerDot).toBeInTheDocument();
    expect(solidInnerDot).toHaveClass("rounded-full");
  });

  it("renders live pulse indicator when status is 'IN_PROGRESS' (case and whitespace insensitive)", () => {
    render(
      <CoworkingSessionCard
        session={{ ...baseSession, status: "  in_progress  " }}
      />,
    );

    expect(screen.getByTestId("live-pulse-indicator")).toBeInTheDocument();
    expect(screen.getByTestId("session-status-badge")).toHaveTextContent(
      "Live Coworking Session",
    );
  });

  it("does not render pulse indicator when status is 'SCHEDULED' or inactive", () => {
    render(
      <CoworkingSessionCard
        session={{ ...baseSession, status: "SCHEDULED" }}
      />,
    );

    expect(
      screen.queryByTestId("live-pulse-indicator"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("session-status-badge")).toHaveTextContent(
      "Coworking Session",
    );
  });

  it("does not render pulse indicator when status is unknown or arbitrary", () => {
    render(
      <CoworkingSessionCard
        session={{ ...baseSession, status: "UPCOMING_SOON" }}
      />,
    );

    expect(
      screen.queryByTestId("live-pulse-indicator"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("session-status-badge")).toHaveTextContent(
      "Coworking Session",
    );
  });

  it("does not render pulse indicator when status is undefined or null", () => {
    const { rerender } = render(
      <CoworkingSessionCard session={{ ...baseSession, status: undefined }} />,
    );
    expect(
      screen.queryByTestId("live-pulse-indicator"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("session-status-badge")).toHaveTextContent(
      "Coworking Session",
    );

    rerender(
      <CoworkingSessionCard session={{ ...baseSession, status: null }} />,
    );
    expect(
      screen.queryByTestId("live-pulse-indicator"),
    ).not.toBeInTheDocument();
  });

  it("renders all session card details correctly", () => {
    render(
      <CoworkingSessionCard session={{ ...baseSession, status: "LIVE" }} />,
    );

    expect(screen.getByText("Morning Deep Work")).toBeInTheDocument();
    expect(
      screen.getByText("Silent coworking block for engineers and designers."),
    ).toBeInTheDocument();
    expect(screen.getByText("Downtown Innovation Hub")).toBeInTheDocument();
    expect(screen.getByText("Alice Chen")).toBeInTheDocument();
    expect(screen.getByText("14 joined")).toBeInTheDocument();
  });

  it("handles Add to Calendar dropdown toggle, outside click, and export actions", () => {
    const windowOpenSpy = jest.spyOn(window, "open").mockImplementation();
    const downloadIcsSpy = jest
      .spyOn(icsGenerator, "downloadIcsFile")
      .mockImplementation();

    render(
      <CoworkingSessionCard session={{ ...baseSession, status: "LIVE" }} />,
    );

    const toggleButton = screen.getByRole("button", {
      name: /Add to Calendar/i,
    });
    expect(toggleButton).toHaveAttribute("aria-expanded", "false");

    // Open dropdown
    fireEvent.click(toggleButton);
    expect(toggleButton).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("menu")).toBeInTheDocument();

    // Click Google Calendar
    const gCalButton = screen.getByRole("menuitem", {
      name: /Google Calendar/i,
    });
    fireEvent.click(gCalButton);
    expect(windowOpenSpy).toHaveBeenCalledWith(
      expect.stringContaining("calendar.google.com"),
      "_blank",
      "noopener,noreferrer",
    );
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();

    // Open dropdown again and click ICS download
    fireEvent.click(toggleButton);
    const icsButton = screen.getByRole("menuitem", {
      name: /Apple \/ Outlook/i,
    });
    fireEvent.click(icsButton);
    expect(downloadIcsSpy).toHaveBeenCalledWith(
      expect.objectContaining({ id: "session-123" }),
    );
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();

    // Open dropdown and click outside to close
    fireEvent.click(toggleButton);
    expect(screen.getByRole("menu")).toBeInTheDocument();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();

    windowOpenSpy.mockRestore();
    downloadIcsSpy.mockRestore();
  });
});
