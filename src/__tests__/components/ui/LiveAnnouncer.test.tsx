import React from "react";
import { render, screen, act } from "@testing-library/react";
import { LiveAnnouncer } from "@/components/ui/LiveAnnouncer";

describe("LiveAnnouncer (#7609)", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const region = () => screen.getByTestId("live-announcer");

  it("renders a polite, atomic, visually hidden status region", () => {
    render(<LiveAnnouncer message="" />);

    expect(region()).toHaveAttribute("role", "status");
    expect(region()).toHaveAttribute("aria-live", "polite");
    expect(region()).toHaveAttribute("aria-atomic", "true");
    expect(region()).toHaveClass("sr-only");
  });

  it("does not announce the initial message on mount", () => {
    render(<LiveAnnouncer message="Found 3 matching workspaces" />);
    act(() => {
      jest.advanceTimersByTime(1000);
    });

    expect(region()).toHaveTextContent("");
  });

  it("announces an updated message after the delay", () => {
    const { rerender } = render(<LiveAnnouncer message="" delayMs={500} />);

    rerender(
      <LiveAnnouncer message="Found 12 matching workspaces" delayMs={500} />,
    );
    act(() => {
      jest.advanceTimersByTime(499);
    });
    expect(region()).toHaveTextContent("");

    act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(region()).toHaveTextContent("Found 12 matching workspaces");
  });

  it("debounces rapid updates so only the last message is announced", () => {
    const { rerender } = render(<LiveAnnouncer message="" />);

    rerender(<LiveAnnouncer message="Found 3 matching workspaces" />);
    act(() => {
      jest.advanceTimersByTime(200);
    });
    rerender(<LiveAnnouncer message="Found 7 matching workspaces" />);
    act(() => {
      jest.advanceTimersByTime(200);
    });
    expect(region()).toHaveTextContent("");

    act(() => {
      jest.advanceTimersByTime(500);
    });
    expect(region()).toHaveTextContent("Found 7 matching workspaces");
  });

  it("re-announces identical text when the announce key changes", () => {
    const message = "Found 5 matching workspaces";
    const { rerender } = render(<LiveAnnouncer message="" announceKey={0} />);

    rerender(<LiveAnnouncer message={message} announceKey={1} />);
    act(() => {
      jest.advanceTimersByTime(500);
    });
    expect(region()).toHaveTextContent(message);

    rerender(<LiveAnnouncer message={message} announceKey={2} />);
    expect(region()).toHaveTextContent("");
    act(() => {
      jest.advanceTimersByTime(500);
    });
    expect(region()).toHaveTextContent(message);
  });

  it("clears the region when the message becomes empty", () => {
    const { rerender } = render(<LiveAnnouncer message="" />);
    rerender(<LiveAnnouncer message="Found 2 matching workspaces" />);
    act(() => {
      jest.advanceTimersByTime(500);
    });

    rerender(<LiveAnnouncer message="" />);
    act(() => {
      jest.advanceTimersByTime(500);
    });
    expect(region()).toHaveTextContent("");
  });
});
