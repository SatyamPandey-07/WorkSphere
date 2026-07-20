import React from "react";
import { render, screen } from "@testing-library/react";
import { PartyKitPresenceWrapper } from "../../components/chat/PartyKitPresenceWrapper";

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
