import React from "react";
import { render, screen } from "@testing-library/react";
import {
  WingmanBadge,
  calculateFlightRank,
  getFlightRank,
  FLIGHT_RANK_TIERS,
} from "@/components/profile/WingmanBadge";
import { ProfileOverview } from "@/components/profile/ProfileOverview";

describe("Flight Wingman Rank & Badge", () => {
  describe("Flight Rank Tier Threshold Calculation", () => {
    it("maps 0 to 9 hours to Rookie tier", () => {
      expect(calculateFlightRank(0).tier).toBe("Rookie");
      expect(calculateFlightRank(5).tier).toBe("Rookie");
      expect(calculateFlightRank(9.9).tier).toBe("Rookie");
      expect(calculateFlightRank(-5).tier).toBe("Rookie");
    });

    it("maps 10 to 49 hours to Flight Officer tier", () => {
      expect(calculateFlightRank(10).tier).toBe("Flight Officer");
      expect(calculateFlightRank(25).tier).toBe("Flight Officer");
      expect(calculateFlightRank(49.9).tier).toBe("Flight Officer");
    });

    it("maps 50 to 99 hours to Lead Pilot tier", () => {
      expect(calculateFlightRank(50).tier).toBe("Lead Pilot");
      expect(calculateFlightRank(75).tier).toBe("Lead Pilot");
      expect(calculateFlightRank(99.9).tier).toBe("Lead Pilot");
    });

    it("maps 100+ hours to Squadron Commander tier", () => {
      expect(calculateFlightRank(100).tier).toBe("Squadron Commander");
      expect(calculateFlightRank(150).tier).toBe("Squadron Commander");
      expect(calculateFlightRank(500).tier).toBe("Squadron Commander");
    });

    it("getFlightRank is an alias for calculateFlightRank", () => {
      expect(getFlightRank(120).tier).toBe("Squadron Commander");
      expect(getFlightRank(15).tier).toBe("Flight Officer");
    });

    it("exposes all rank tier definitions", () => {
      expect(FLIGHT_RANK_TIERS["Rookie"].minHours).toBe(0);
      expect(FLIGHT_RANK_TIERS["Flight Officer"].minHours).toBe(10);
      expect(FLIGHT_RANK_TIERS["Lead Pilot"].minHours).toBe(50);
      expect(FLIGHT_RANK_TIERS["Squadron Commander"].minHours).toBe(100);
    });
  });

  describe("WingmanBadge Component", () => {
    it("renders Rookie rank badge for user with 5 co-working hours", () => {
      render(<WingmanBadge coWorkingHours={5} sharedSessionsCount={2} />);

      expect(screen.getByTestId("flight-wingman-badge")).toBeInTheDocument();
      expect(screen.getByText("Rookie")).toBeInTheDocument();
      expect(screen.getByText(/5 hrs co-working/i)).toBeInTheDocument();
      expect(screen.getByText(/2 shared sessions/i)).toBeInTheDocument();
    });

    it("renders Lead Pilot rank badge for 60 co-working hours", () => {
      render(<WingmanBadge coWorkingHours={60} sharedSessionsCount={12} />);

      expect(screen.getByText("Lead Pilot")).toBeInTheDocument();
      expect(screen.getByText(/60 hrs co-working/i)).toBeInTheDocument();
      expect(screen.getByText(/12 shared sessions/i)).toBeInTheDocument();
    });

    it("renders Squadron Commander badge for 120 co-working hours", () => {
      render(<WingmanBadge coWorkingHours={120} sharedSessionsCount={30} />);

      expect(screen.getByText("Squadron Commander")).toBeInTheDocument();
    });

    it("hides stats when showStats is false", () => {
      render(
        <WingmanBadge
          coWorkingHours={20}
          sharedSessionsCount={4}
          showStats={false}
        />,
      );

      expect(screen.getByText("Flight Officer")).toBeInTheDocument();
      expect(screen.queryByText(/20 hrs co-working/i)).not.toBeInTheDocument();
    });

    it("supports tierOverride", () => {
      render(
        <WingmanBadge
          coWorkingHours={5}
          tierOverride="Squadron Commander"
        />,
      );

      expect(screen.getByText("Squadron Commander")).toBeInTheDocument();
    });

    it("provides accessible aria-label", () => {
      render(<WingmanBadge coWorkingHours={55} sharedSessionsCount={10} />);

      const badge = screen.getByTestId("flight-wingman-badge");
      expect(badge).toHaveAttribute(
        "aria-label",
        expect.stringContaining("Lead Pilot"),
      );
    });
  });

  describe("ProfileOverview Component", () => {
    it("renders profile card with Flight Wingman badge", () => {
      render(
        <ProfileOverview
          user={{
            name: "Sarah Connor",
            username: "sconnor",
            location: "Berlin, Germany",
          }}
          stats={{
            coWorkingHours: 80,
            sharedSessionsCount: 18,
            visitedVenuesCount: 9,
            checkInStreakDays: 14,
          }}
        />,
      );

      expect(screen.getByTestId("profile-overview-card")).toBeInTheDocument();
      expect(screen.getByText("Sarah Connor")).toBeInTheDocument();
      expect(screen.getByText("@sconnor")).toBeInTheDocument();
      expect(screen.getByText("Berlin, Germany")).toBeInTheDocument();
      expect(screen.getByText("Lead Pilot")).toBeInTheDocument();
      expect(screen.getByText("80 hrs")).toBeInTheDocument();
      expect(screen.getByText("18")).toBeInTheDocument();
    });
  });
});
