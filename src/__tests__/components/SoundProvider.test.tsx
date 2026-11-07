import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import { SoundProvider, useSound } from "@/components/SoundProvider";

function TestConsumer() {
  const { soundEnabled, toggleSound, setSoundEnabled } = useSound();
  return (
    <div>
      <span data-testid="sound-status">{soundEnabled ? "enabled" : "disabled"}</span>
      <button data-testid="toggle-btn" onClick={toggleSound}>
        Toggle
      </button>
      <button data-testid="enable-btn" onClick={() => setSoundEnabled(true)}>
        Enable
      </button>
      <button data-testid="disable-btn" onClick={() => setSoundEnabled(false)}>
        Disable
      </button>
    </div>
  );
}

describe("SoundProvider and useSound (#6931)", () => {
  const originalLocalStorage = window.localStorage;

  beforeEach(() => {
    window.localStorage.clear();
    jest.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("throws error when useSound is used outside SoundProvider", () => {
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});

    expect(() => render(<TestConsumer />)).toThrow(
      "useSound must be used inside SoundProvider"
    );

    spy.mockRestore();
  });

  it("initializes with defaultEnabled=true when localStorage is empty", () => {
    render(
      <SoundProvider>
        <TestConsumer />
      </SoundProvider>
    );

    expect(screen.getByTestId("sound-status")).toHaveTextContent("enabled");
  });

  it("initializes with custom defaultEnabled=false", () => {
    render(
      <SoundProvider defaultEnabled={false}>
        <TestConsumer />
      </SoundProvider>
    );

    expect(screen.getByTestId("sound-status")).toHaveTextContent("disabled");
  });

  it("loads stored state from localStorage on mount", () => {
    window.localStorage.setItem("worksphere-sound", "false");

    render(
      <SoundProvider>
        <TestConsumer />
      </SoundProvider>
    );

    expect(screen.getByTestId("sound-status")).toHaveTextContent("disabled");
  });

  it("toggles sound preference and persists to localStorage", () => {
    render(
      <SoundProvider defaultEnabled={true}>
        <TestConsumer />
      </SoundProvider>
    );

    const toggleBtn = screen.getByTestId("toggle-btn");

    // Toggle to false
    fireEvent.click(toggleBtn);
    expect(screen.getByTestId("sound-status")).toHaveTextContent("disabled");
    expect(window.localStorage.getItem("worksphere-sound")).toBe("false");

    // Toggle back to true
    fireEvent.click(toggleBtn);
    expect(screen.getByTestId("sound-status")).toHaveTextContent("enabled");
    expect(window.localStorage.getItem("worksphere-sound")).toBe("true");
  });

  it("supports explicit setSoundEnabled calls", () => {
    render(
      <SoundProvider defaultEnabled={true}>
        <TestConsumer />
      </SoundProvider>
    );

    const disableBtn = screen.getByTestId("disable-btn");
    const enableBtn = screen.getByTestId("enable-btn");

    fireEvent.click(disableBtn);
    expect(screen.getByTestId("sound-status")).toHaveTextContent("disabled");
    expect(window.localStorage.getItem("worksphere-sound")).toBe("false");

    fireEvent.click(enableBtn);
    expect(screen.getByTestId("sound-status")).toHaveTextContent("enabled");
    expect(window.localStorage.getItem("worksphere-sound")).toBe("true");
  });

  it("uses custom storageKey when provided", () => {
    window.localStorage.setItem("custom-sound-key", "false");

    render(
      <SoundProvider storageKey="custom-sound-key">
        <TestConsumer />
      </SoundProvider>
    );

    expect(screen.getByTestId("sound-status")).toHaveTextContent("disabled");

    fireEvent.click(screen.getByTestId("toggle-btn"));
    expect(screen.getByTestId("sound-status")).toHaveTextContent("enabled");
    expect(window.localStorage.getItem("custom-sound-key")).toBe("true");
  });

  it("handles localStorage read/write failures gracefully in private browsing", () => {
    const mockGetItem = jest.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError: Access is denied for this document");
    });
    const mockSetItem = jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("SecurityError: Access is denied for this document");
    });

    render(
      <SoundProvider defaultEnabled={true}>
        <TestConsumer />
      </SoundProvider>
    );

    // Initial state remains functional
    expect(screen.getByTestId("sound-status")).toHaveTextContent("enabled");

    // Toggling works in memory without throwing
    expect(() => fireEvent.click(screen.getByTestId("toggle-btn"))).not.toThrow();
    expect(screen.getByTestId("sound-status")).toHaveTextContent("disabled");

    // Explicit setter works in memory without throwing
    expect(() => fireEvent.click(screen.getByTestId("enable-btn"))).not.toThrow();
    expect(screen.getByTestId("sound-status")).toHaveTextContent("enabled");

    mockGetItem.mockRestore();
    mockSetItem.mockRestore();
  });

  it("synchronizes audio state across tabs via storage event", () => {
    render(
      <SoundProvider defaultEnabled={true}>
        <TestConsumer />
      </SoundProvider>
    );

    expect(screen.getByTestId("sound-status")).toHaveTextContent("enabled");

    // Simulate cross-tab change to "false"
    act(() => {
      const event = new StorageEvent("storage", {
        key: "worksphere-sound",
        newValue: "false",
      });
      window.dispatchEvent(event);
    });

    expect(screen.getByTestId("sound-status")).toHaveTextContent("disabled");

    // Simulate event with unrelated key (should be ignored)
    act(() => {
      const event = new StorageEvent("storage", {
        key: "other-key",
        newValue: "true",
      });
      window.dispatchEvent(event);
    });

    expect(screen.getByTestId("sound-status")).toHaveTextContent("disabled");
  });
});
