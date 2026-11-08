import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import AmbientCoworkingCircle, {
  calculateOrbitalPosition,
  DEFAULT_ORBIT_RINGS,
  DEFAULT_COWORKER_PEERS,
  type CoworkerPeer,
} from "@/components/social/AmbientCoworkingCircle";

jest.mock("@/lib/audio/ambientFocusEngine", () => {
  const actual = jest.requireActual("@/lib/audio/ambientFocusEngine");
  return {
    ...actual,
    AmbientAudioSynthesizer: jest.fn().mockImplementation(() => ({
      init: jest.fn(),
      playTrack: jest.fn(),
      stopTrack: jest.fn(),
      setMuted: jest.fn(),
      playChime: jest.fn(),
    })),
  };
});

describe("AmbientCoworkingCircle - Aerospace Orbital Concentric Radar", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    act(() => {
      jest.runOnlyPendingTimers();
    });
    jest.useRealTimers();
  });

  describe("calculateOrbitalPosition (Trigonometric Coordinates)", () => {
    const center = { x: 200, y: 200 };
    const radius = 100;

    it("calculates position at 0 radians (East / 3 o'clock)", () => {
      const pos = calculateOrbitalPosition(center, radius, 0);
      expect(pos.x).toBe(300);
      expect(pos.y).toBe(200);
    });

    it("calculates position at π/2 radians (South / 6 o'clock)", () => {
      const pos = calculateOrbitalPosition(center, radius, Math.PI / 2);
      expect(pos.x).toBe(200);
      expect(pos.y).toBe(300);
    });

    it("calculates position at π radians (West / 9 o'clock)", () => {
      const pos = calculateOrbitalPosition(center, radius, Math.PI);
      expect(pos.x).toBe(100);
      expect(pos.y).toBe(200);
    });

    it("calculates position at 3π/2 radians (North / 12 o'clock)", () => {
      const pos = calculateOrbitalPosition(center, radius, (3 * Math.PI) / 2);
      expect(pos.x).toBe(200);
      expect(pos.y).toBe(100);
    });

    it("calculates position at π/4 radians (45 degrees) accurately", () => {
      const pos = calculateOrbitalPosition(center, radius, Math.PI / 4);
      expect(pos.x).toBeCloseTo(270.71, 1);
      expect(pos.y).toBeCloseTo(270.71, 1);
    });
  });

  describe("Concentric Orbit Radar & Central Room Anchor", () => {
    it("renders the aerospace orbital radar stage and central room anchor hub", () => {
      render(<AmbientCoworkingCircle enableOrbitalMotion={false} />);

      expect(screen.getByTestId("orbital-radar-stage")).toBeInTheDocument();
      expect(screen.getByTestId("orbital-radar-svg")).toBeInTheDocument();

      const anchorHub = screen.getByTestId("central-room-anchor");
      expect(anchorHub).toBeInTheDocument();
      expect(anchorHub).toHaveTextContent("Room Anchor");
      expect(anchorHub).toHaveTextContent("25:00");
      expect(anchorHub).toHaveTextContent("Focus Sprint");
    });

    it("renders subtle concentric orbit path circles in emerald tone", () => {
      render(<AmbientCoworkingCircle enableOrbitalMotion={false} />);

      DEFAULT_ORBIT_RINGS.forEach((ring) => {
        const ringCircle = screen.getByTestId(`orbit-ring-${ring.ring}`);
        expect(ringCircle).toBeInTheDocument();
        expect(ringCircle).toHaveAttribute("stroke", "#10b981");
        expect(ringCircle).toHaveAttribute("r", ring.radius.toString());
        expect(ringCircle).toHaveAttribute("stroke-dasharray", "4 4");
      });
    });

    it("positions coworker avatars along orbit rings using trigonometric coordinates", () => {
      render(<AmbientCoworkingCircle enableOrbitalMotion={false} />);

      // Check peer-elena (Orbit 1, radius 76, angle 0 => center 210, 210 => x: 286, y: 210)
      const elenaAvatar = screen.getByTestId("peer-avatar-peer-elena");
      expect(elenaAvatar).toBeInTheDocument();
      expect(elenaAvatar).toHaveTextContent("ER");

      const elenaWrapper = elenaAvatar.closest(".absolute");
      expect(elenaWrapper).toHaveStyle("left: 286px");
      expect(elenaWrapper).toHaveStyle("top: 210px");

      // Check peer-david (Orbit 1, radius 76, angle PI => x: 134, y: 210)
      const davidAvatar = screen.getByTestId("peer-avatar-peer-david");
      expect(davidAvatar).toBeInTheDocument();
      const davidWrapper = davidAvatar.closest(".absolute");
      expect(davidWrapper).toHaveStyle("left: 134px");
      expect(davidWrapper).toHaveStyle("top: 210px");
    });

    it("renders emerald ping dots on arrival for online coworkers", () => {
      expect(DEFAULT_COWORKER_PEERS.length).toBeGreaterThanOrEqual(6);
      render(<AmbientCoworkingCircle enableOrbitalMotion={false} />);

      // Arrived peers have ping dots
      expect(screen.getByTestId("ping-dot-peer-elena")).toBeInTheDocument();
      expect(screen.getByTestId("ping-dot-peer-david")).toBeInTheDocument();
      expect(screen.getByTestId("ping-dot-peer-marco")).toBeInTheDocument();

      // Sophia Turner has isArrived: false
      expect(
        screen.queryByTestId("ping-dot-peer-sophia"),
      ).not.toBeInTheDocument();
    });
  });

  describe("Interactive Avatar Actions (Profile & Private Chat)", () => {
    it("opens peer interaction modal when an avatar is clicked", () => {
      render(<AmbientCoworkingCircle enableOrbitalMotion={false} />);

      expect(
        screen.queryByTestId("peer-interaction-modal"),
      ).not.toBeInTheDocument();

      const elenaAvatar = screen.getByTestId("peer-avatar-peer-elena");
      fireEvent.click(elenaAvatar);

      const modal = screen.getByTestId("peer-interaction-modal");
      expect(modal).toBeInTheDocument();
      expect(modal).toHaveTextContent("Elena Rostova");
      expect(modal).toHaveTextContent("Staff Distributed Systems Engineer");
      expect(modal).toHaveTextContent("Berlin, DE");
      expect(modal).toHaveTextContent("Orbit Ring 1");
      expect(modal).toHaveTextContent("Synthesizing consensus quorum");
    });

    it("supports clicking Open Profile and triggers onOpenProfile callback", () => {
      const handleOpenProfile = jest.fn();
      render(
        <AmbientCoworkingCircle
          onOpenProfile={handleOpenProfile}
          enableOrbitalMotion={false}
        />,
      );

      fireEvent.click(screen.getByTestId("peer-avatar-peer-marco"));

      const openProfileBtn = screen.getByTestId("open-profile-btn");
      expect(openProfileBtn).toBeInTheDocument();
      fireEvent.click(openProfileBtn);

      expect(handleOpenProfile).toHaveBeenCalledTimes(1);
      expect(handleOpenProfile).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "peer-marco",
          name: "Marco Polo",
          location: "Tokyo, JP",
        }),
      );
      expect(screen.getByTestId("peer-action-feedback")).toHaveTextContent(
        "Profile opened for Marco Polo",
      );
    });

    it("supports clicking Start Private Chat and triggers onStartPrivateChat callback", () => {
      const handleStartChat = jest.fn();
      render(
        <AmbientCoworkingCircle
          onStartPrivateChat={handleStartChat}
          enableOrbitalMotion={false}
        />,
      );

      fireEvent.click(screen.getByTestId("peer-avatar-peer-amara"));

      const startChatBtn = screen.getByTestId("start-chat-btn");
      expect(startChatBtn).toBeInTheDocument();
      fireEvent.click(startChatBtn);

      expect(handleStartChat).toHaveBeenCalledTimes(1);
      expect(handleStartChat).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "peer-amara",
          name: "Amara Zane",
          role: "Security Protocol Analyst",
        }),
      );
      expect(screen.getByTestId("peer-action-feedback")).toHaveTextContent(
        "Private chat initiated with Amara Zane",
      );
    });

    it("closes the peer interaction modal when close button is clicked", () => {
      render(<AmbientCoworkingCircle enableOrbitalMotion={false} />);

      fireEvent.click(screen.getByTestId("peer-avatar-peer-david"));
      expect(screen.getByTestId("peer-interaction-modal")).toBeInTheDocument();

      fireEvent.click(screen.getByTestId("close-peer-modal-btn"));
      expect(
        screen.queryByTestId("peer-interaction-modal"),
      ).not.toBeInTheDocument();
    });
  });

  describe("Custom Coworker Peers & Timer Controls", () => {
    it("renders custom coworker peers passed as props", () => {
      const customPeers: CoworkerPeer[] = [
        {
          id: "custom-pilot-1",
          name: "Nova Sterling",
          role: "Chief Orbital Navigator",
          location: "Geneva, CH",
          initials: "NS",
          status: "focusing",
          orbitRing: 2,
          baseAngle: Math.PI / 2,
          isArrived: true,
          currentTask: "Recalibrating stellar telemetry",
        },
      ];

      render(
        <AmbientCoworkingCircle
          initialPeers={customPeers}
          enableOrbitalMotion={false}
        />,
      );

      expect(
        screen.getByTestId("peer-avatar-custom-pilot-1"),
      ).toBeInTheDocument();
      expect(screen.getByTestId("ping-dot-custom-pilot-1")).toBeInTheDocument();
      expect(screen.getByText("1 Coworkers in Orbit")).toBeInTheDocument();
    });

    it("allows pausing, resuming, and resetting the orbit sprint timer", () => {
      render(<AmbientCoworkingCircle enableOrbitalMotion={false} />);

      const toggleBtn = screen.getByRole("button", {
        name: /pause orbit sprint/i,
      });
      fireEvent.click(toggleBtn);
      expect(screen.getByText(/resume orbit sprint/i)).toBeInTheDocument();

      fireEvent.click(
        screen.getByRole("button", { name: /resume orbit sprint/i }),
      );
      expect(screen.getByText(/pause orbit sprint/i)).toBeInTheDocument();

      const resetBtn = screen.getByTitle("Reset Timer");
      fireEvent.click(resetBtn);
      expect(screen.getByTestId("central-room-anchor")).toHaveTextContent(
        "25:00",
      );
    });

    it("allows toggling audio mute", () => {
      render(<AmbientCoworkingCircle enableOrbitalMotion={false} />);

      const muteBtn = screen.getByTitle("Mute Audio");
      fireEvent.click(muteBtn);
      expect(screen.getByTitle("Unmute Audio")).toBeInTheDocument();

      fireEvent.click(screen.getByTitle("Unmute Audio"));
      expect(screen.getByTitle("Mute Audio")).toBeInTheDocument();
    });
  });
});
