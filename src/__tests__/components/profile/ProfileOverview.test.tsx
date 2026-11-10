import React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { ProfileOverview } from "@/components/profile/ProfileOverview";

describe("ProfileOverview", () => {
  it("renders with default user and default stats when no props passed", () => {
    render(<ProfileOverview />);

    expect(screen.getByTestId("profile-overview-card")).toBeInTheDocument();
    expect(screen.getByTestId("profile-overview-name")).toHaveTextContent("Alex Nomad");
    expect(screen.getByTestId("profile-overview-username")).toHaveTextContent("@alexnomad");
    expect(screen.getByTestId("profile-overview-location")).toHaveTextContent("Global Remote");
    expect(screen.getByTestId("profile-overview-joined")).toHaveTextContent("Member since Jan 2024");

    expect(screen.getByTestId("profile-overview-coworking-hours")).toHaveTextContent("65 hrs");
    expect(screen.getByTestId("profile-overview-shared-sessions")).toHaveTextContent("14");
    expect(screen.getByTestId("profile-overview-wingman-level")).toHaveTextContent("Lead Pilot");
    expect(screen.getByTestId("profile-overview-visited-venues")).toHaveTextContent("12");
  });

  it("renders custom user details and avatar image", () => {
    const user = {
      name: "Satoshi Nakamoto",
      username: "satoshi",
      avatarUrl: "https://example.com/avatar.jpg",
      location: "Cyberspace",
      joinedDate: "Member since Jan 2009",
    };

    render(<ProfileOverview user={user} />);

    expect(screen.getByTestId("profile-overview-name")).toHaveTextContent("Satoshi Nakamoto");
    expect(screen.getByTestId("profile-overview-username")).toHaveTextContent("@satoshi");
    expect(screen.getByTestId("profile-overview-location")).toHaveTextContent("Cyberspace");
    expect(screen.getByTestId("profile-overview-joined")).toHaveTextContent("Member since Jan 2009");

    const img = screen.getByRole("img", { name: "Satoshi Nakamoto" });
    expect(img).toBeInTheDocument();
    expect(img).toHaveAttribute("src", "https://example.com/avatar.jpg");
  });

  it("renders initials fallback when avatarUrl is missing", () => {
    const user = {
      name: "Elena Rostova",
    };

    render(<ProfileOverview user={user} />);

    expect(screen.getByTestId("profile-overview-avatar")).toHaveTextContent("ER");
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("renders custom activity stats accurately", () => {
    const stats = {
      coWorkingHours: 120,
      sharedSessionsCount: 35,
      visitedVenuesCount: 42,
      checkInStreakDays: 15,
    };

    render(<ProfileOverview stats={stats} />);

    expect(screen.getByTestId("profile-overview-coworking-hours")).toHaveTextContent("120 hrs");
    expect(screen.getByTestId("profile-overview-shared-sessions")).toHaveTextContent("35");
    expect(screen.getByTestId("profile-overview-wingman-level")).toHaveTextContent("Squadron Commander");
    expect(screen.getByTestId("profile-overview-visited-venues")).toHaveTextContent("42");
  });

  it("calculates lower flight rank for low co-working hours", () => {
    const stats = {
      coWorkingHours: 5,
      sharedSessionsCount: 1,
      visitedVenuesCount: 2,
    };

    render(<ProfileOverview stats={stats} />);

    expect(screen.getByTestId("profile-overview-coworking-hours")).toHaveTextContent("5 hrs");
    expect(screen.getByTestId("profile-overview-wingman-level")).toHaveTextContent("Rookie");
  });

  it("handles null user and null stats safely without crashing", () => {
    render(<ProfileOverview user={null} stats={null} />);

    expect(screen.getByTestId("profile-overview-card")).toBeInTheDocument();
    expect(screen.getByTestId("profile-overview-name")).toHaveTextContent("Alex Nomad");
    expect(screen.getByTestId("profile-overview-coworking-hours")).toHaveTextContent("65 hrs");
  });

  it("applies custom className to card", () => {
    render(<ProfileOverview className="custom-test-card" />);

    expect(screen.getByTestId("profile-overview-card")).toHaveClass("custom-test-card");
  });
});
