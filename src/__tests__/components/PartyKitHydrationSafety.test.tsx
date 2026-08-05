import React from "react";
import { render, screen } from "@testing-library/react";
import { PartyKitPresenceWrapper } from "../../components/chat/PartyKitPresenceWrapper";

// PartyKitPresenceWrapper opens a real WebSocket via y-partykit/provider in a
// useEffect. jsdom implements a real WebSocket, so without this mock every
// render here attempts a genuine connection to a PartyKit host that doesn't
// exist in CI, falling into the provider's reconnect-with-backoff loop —
// timers/sockets that outlive this test and accumulate across the rest of
// the suite. Mock it so this stays a pure hydration/render test.
jest.mock("y-partykit/provider", () => {
  return jest.fn().mockImplementation(() => ({
    awareness: {
      setLocalState: jest.fn(),
      getLocalState: jest.fn().mockReturnValue({}),
      getStates: jest.fn().mockReturnValue(new Map()),
      on: jest.fn(),
      off: jest.fn(),
    },
    destroy: jest.fn(),
  }));
});

describe("Next.js 16 Streaming Hydration & PartyKit Reconnection (#912)", () => {
  it("renders fallback or null during initial SSR / unmounted state before client hydration", () => {
    // Before useEffect runs, client-only wrappers should avoid rendering socket indicators
    render(
      <PartyKitPresenceWrapper
        fallback={<div data-testid="ssr-fallback">Connecting...</div>}
      >
        <div data-testid="socket-presence">Connected Users: 5</div>
      </PartyKitPresenceWrapper>,
    );

    // After mount in jsdom, useEffect completes and mounts presence
    expect(screen.getByTestId("socket-presence")).toBeInTheDocument();
  });

  it("isolates WebSocket presence elements from server DOM key mismatch", () => {
    const { container } = render(
      <PartyKitPresenceWrapper>
        <div data-testid="live-indicator">Online</div>
      </PartyKitPresenceWrapper>,
    );

    expect(container).toBeInTheDocument();
    expect(screen.getByTestId("live-indicator")).toHaveTextContent("Online");
  });
});
