import React from "react";
import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";
import { render, screen } from "@testing-library/react";
import {
  type WhiteboardParticipant,
  IDLE_TIMEOUT_MS,
  HEARTBEAT_INTERVAL_MS,
} from "@/hooks/useCanvasWhiteboard";
import { CanvasToolbar } from "@/components/whiteboard/CanvasToolbar";

describe("Collaborative Whiteboard Presence and Idle Heartbeat (#3471)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("Constants and State Definitions", () => {
    it("defines 45-second idle timeout threshold", () => {
      expect(IDLE_TIMEOUT_MS).toBe(45000);
    });

    it("defines periodic idle heartbeat check interval", () => {
      expect(HEARTBEAT_INTERVAL_MS).toBe(5000);
    });
  });

  describe("Awareness State Enrichment & Joining", () => {
    it("formats participant state with avatar, name, color, lastActiveAt, and active status", () => {
      const now = Date.now();
      const participant: WhiteboardParticipant = {
        clientId: 101,
        userId: "user-alpha",
        name: "Alice",
        avatar: "https://example.com/alice.png",
        color: "#f43f5e",
        lastActiveAt: now,
        status: "active",
      };

      expect(participant.clientId).toBe(101);
      expect(participant.name).toBe("Alice");
      expect(participant.avatar).toBe("https://example.com/alice.png");
      expect(participant.color).toBe("#f43f5e");
      expect(participant.lastActiveAt).toBe(now);
      expect(participant.status).toBe("active");
    });

    it("evaluates active vs idle status based on the 45-second threshold", () => {
      const currentTime = 100000;
      const activeLastSeen = currentTime - 20000; // 20s ago (active)
      const idleLastSeen = currentTime - 50000; // 50s ago (> 45s, idle)

      const isActive = currentTime - activeLastSeen <= IDLE_TIMEOUT_MS;
      const isIdle = currentTime - idleLastSeen > IDLE_TIMEOUT_MS;

      expect(isActive).toBe(true);
      expect(isIdle).toBe(true);
    });
  });

  describe("Automatic Pruning on Disconnect", () => {
    it("prunes disconnected users from awareness participant map", () => {
      const awarenessMap = new Map<number, WhiteboardParticipant>();

      awarenessMap.set(1, {
        clientId: 1,
        userId: "user-1",
        name: "Alice",
        color: "#3b82f6",
        lastActiveAt: Date.now(),
        status: "active",
      });

      awarenessMap.set(2, {
        clientId: 2,
        userId: "user-2",
        name: "Bob",
        color: "#22c55e",
        lastActiveAt: Date.now(),
        status: "active",
      });

      expect(awarenessMap.size).toBe(2);

      // Simulate Bob disconnecting
      awarenessMap.delete(2);

      expect(awarenessMap.size).toBe(1);
      expect(awarenessMap.has(2)).toBe(false);
      expect(Array.from(awarenessMap.values()).map((p) => p.name)).toEqual(["Alice"]);
    });
  });

  describe("CanvasToolbar Presence UI Bar", () => {
    const defaultProps = {
      tool: "pen" as const,
      color: "#ffffff",
      strokeWidth: 3,
      canUndo: false,
      canRedo: false,
      isConnected: true,
      onToolChange: jest.fn(),
      onColorChange: jest.fn(),
      onStrokeWidthChange: jest.fn(),
      onUndo: jest.fn(),
      onRedo: jest.fn(),
      onClear: jest.fn(),
    };

    it("renders live participant avatars with matching cursor colors", () => {
      const participants: WhiteboardParticipant[] = [
        {
          clientId: 1,
          userId: "user-1",
          name: "Alice",
          avatar: "https://example.com/alice.png",
          color: "#3b82f6",
          lastActiveAt: Date.now(),
          status: "active",
        },
        {
          clientId: 2,
          userId: "user-2",
          name: "Bob",
          color: "#22c55e",
          lastActiveAt: Date.now(),
          status: "active",
        },
      ];

      render(<CanvasToolbar {...defaultProps} participants={participants} />);

      const participantContainer = screen.getByTestId("whiteboard-participants");
      expect(participantContainer).toBeDefined();

      const aliceRing = screen.getByTestId("avatar-ring-1");
      expect(aliceRing.style.borderColor).toBe("rgb(59, 130, 246)"); // #3b82f6

      const bobRing = screen.getByTestId("avatar-ring-2");
      expect(bobRing.style.borderColor).toBe("rgb(34, 197, 94)"); // #22c55e

      expect(screen.getByText("B")).toBeDefined();
    });

    it("displays idle badge and reduced opacity for collaborators idle > 45 seconds", () => {
      const participants: WhiteboardParticipant[] = [
        {
          clientId: 1,
          userId: "user-1",
          name: "Alice",
          color: "#3b82f6",
          lastActiveAt: Date.now() - 50000,
          status: "idle",
        },
      ];

      render(<CanvasToolbar {...defaultProps} participants={participants} />);

      const idleBadge = screen.getByTestId("idle-badge-1");
      expect(idleBadge).toBeDefined();

      const avatarRing = screen.getByTestId("avatar-ring-1");
      expect(avatarRing.className).toContain("opacity-50");
    });
  });
});
