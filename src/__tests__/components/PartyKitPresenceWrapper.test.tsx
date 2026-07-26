import React from "react";
import { render, screen, act } from "@testing-library/react";
import { PartyKitPresenceWrapper } from "../../components/chat/PartyKitPresenceWrapper";
import { useUser } from "@clerk/nextjs";

jest.mock("@clerk/nextjs", () => ({
  useUser: jest.fn(),
}));

const mockAwarenessHandlers: (() => void)[] = [];
const mockAwareness = {
  clientID: 1,
  getLocalState: jest.fn().mockReturnValue({}),
  setLocalState: jest.fn(),
  getStates: jest.fn().mockReturnValue(new Map()),
  on: jest.fn((event, handler) => {
    mockAwarenessHandlers.push(handler);
  }),
  off: jest.fn(),
};

jest.mock("y-partykit/provider", () => {
  return jest.fn().mockImplementation(() => ({
    awareness: mockAwareness,
    destroy: jest.fn(),
  }));
});

describe("PartyKitPresenceWrapper Active Presence List", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAwarenessHandlers.length = 0;
    (useUser as jest.Mock).mockReturnValue({
      isSignedIn: true,
      user: {
        fullName: "Test User",
        imageUrl: "http://example.com/avatar.png",
      },
    });
  });

  it("renders children and live collaborative users presence", async () => {
    // Mock 2 users in awareness states
    const statesMap = new Map([
      [1, { user: { name: "Test User", avatar: "http://example.com/avatar.png", role: "Member", status: "active" } }],
      [2, { user: { name: "Idle Peer", avatar: null, role: "Guest", status: "idle" } }],
    ]);
    mockAwareness.getStates.mockReturnValue(statesMap);

    render(
      <PartyKitPresenceWrapper>
        <div data-testid="child-element">Child Content</div>
      </PartyKitPresenceWrapper>
    );

    // Call the awareness change handler to trigger state update
    expect(mockAwarenessHandlers.length).toBeGreaterThan(0);
    await act(async () => {
      mockAwarenessHandlers[0]();
    });

    // Check if children are rendered
    expect(screen.getByTestId("child-element")).toBeInTheDocument();

    // Check if avatars/labels are rendered
    expect(screen.getByText("Active Now:")).toBeInTheDocument();
    expect(screen.getByText("Test User")).toBeInTheDocument();
    expect(screen.getByText("Idle Peer")).toBeInTheDocument();
  });
});
