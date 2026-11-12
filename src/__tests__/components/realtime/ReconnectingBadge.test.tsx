import React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { ReconnectingBadge } from "@/components/realtime/ReconnectingBadge";
import { ConnectionLifecycleState } from "@/lib/realtime/connectionState";

describe("ReconnectingBadge", () => {
  it("renders null when no reconnecting props are passed", () => {
    const { container } = render(<ReconnectingBadge />);
    expect(container.firstChild).toBeNull();
  });

  it("renders null when status is connected even if attempt count is passed", () => {
    const { container } = render(
      <ReconnectingBadge status="connected" attempt={3} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders null when status is ConnectionLifecycleState.CONNECTED", () => {
    const { container } = render(
      <ReconnectingBadge
        status={ConnectionLifecycleState.CONNECTED}
        attempt={2}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders badge when isReconnecting is true", () => {
    render(<ReconnectingBadge isReconnecting={true} />);

    const badge = screen.getByTestId("reconnecting-badge");
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveAttribute("role", "status");
    expect(badge).toHaveAttribute("aria-live", "polite");
    expect(badge).toHaveAttribute(
      "aria-label",
      "Connection status: reconnecting",
    );
    expect(screen.getByTestId("reconnecting-badge-label")).toHaveTextContent(
      "Reconnecting...",
    );
  });

  it("renders badge when status is 'reconnecting'", () => {
    render(<ReconnectingBadge status="reconnecting" />);

    expect(screen.getByTestId("reconnecting-badge")).toBeInTheDocument();
    expect(screen.getByTestId("reconnecting-badge-label")).toHaveTextContent(
      "Reconnecting...",
    );
  });

  it("renders badge when status is ConnectionLifecycleState.RECONNECTING", () => {
    render(
      <ReconnectingBadge status={ConnectionLifecycleState.RECONNECTING} />,
    );

    expect(screen.getByTestId("reconnecting-badge")).toBeInTheDocument();
  });

  it("renders badge when lifecycleState is ConnectionLifecycleState.RECONNECTING", () => {
    render(
      <ReconnectingBadge
        lifecycleState={ConnectionLifecycleState.RECONNECTING}
      />,
    );

    expect(screen.getByTestId("reconnecting-badge")).toBeInTheDocument();
  });

  it("renders badge when positive numeric attempt is provided without connected status", () => {
    render(<ReconnectingBadge attempt={2} />);

    const badge = screen.getByTestId("reconnecting-badge");
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveAttribute(
      "aria-label",
      "Connection status: reconnecting (attempt 2)",
    );
    expect(screen.getByTestId("reconnecting-badge-label")).toHaveTextContent(
      "Reconnecting...",
    );
  });

  it("displays attempt counter when showAttempt is true and valid attempt is passed", () => {
    render(<ReconnectingBadge attempt={4} showAttempt={true} />);

    const label = screen.getByTestId("reconnecting-badge-label");
    expect(label).toHaveTextContent("Reconnecting (attempt 4)...");
  });

  it("floors float attempt values and displays sanitized attempt counter", () => {
    render(<ReconnectingBadge attempt={3.7} showAttempt={true} />);

    const label = screen.getByTestId("reconnecting-badge-label");
    expect(label).toHaveTextContent("Reconnecting (attempt 3)...");
  });

  it("sanitizes non-finite or negative attempts and returns null if no other triggers", () => {
    const { container: c1 } = render(<ReconnectingBadge attempt={-1} />);
    expect(c1.firstChild).toBeNull();

    const { container: c2 } = render(<ReconnectingBadge attempt={NaN} />);
    expect(c2.firstChild).toBeNull();

    const { container: c3 } = render(<ReconnectingBadge attempt={Infinity} />);
    expect(c3.firstChild).toBeNull();
  });

  it("applies custom className using cn utility", () => {
    render(
      <ReconnectingBadge
        isReconnecting={true}
        className="custom-reconnecting-class shadow-lg"
      />,
    );

    const badge = screen.getByTestId("reconnecting-badge");
    expect(badge).toHaveClass("custom-reconnecting-class");
    expect(badge).toHaveClass("shadow-lg");
  });
});
