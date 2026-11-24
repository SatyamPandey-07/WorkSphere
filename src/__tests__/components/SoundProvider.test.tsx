import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import {
  SoundProvider,
  useSound,
  playBookmarkChime,
  playUnbookmarkTone,
} from "@/components/SoundProvider";

function TestConsumer() {
  const { soundEnabled, toggleSound, setSoundEnabled } = useSound();
  return (
    <div>
      <span data-testid="sound-status">
        {soundEnabled ? "enabled" : "disabled"}
      </span>
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
      "useSound must be used inside SoundProvider",
    );

    spy.mockRestore();
  });

  it("initializes with defaultEnabled=true when localStorage is empty", () => {
    render(
      <SoundProvider>
        <TestConsumer />
      </SoundProvider>,
    );

    expect(screen.getByTestId("sound-status")).toHaveTextContent("enabled");
  });

  it("initializes with custom defaultEnabled=false", () => {
    render(
      <SoundProvider defaultEnabled={false}>
        <TestConsumer />
      </SoundProvider>,
    );

    expect(screen.getByTestId("sound-status")).toHaveTextContent("disabled");
  });

  it("loads stored state from localStorage on mount", () => {
    window.localStorage.setItem("worksphere-sound", "false");

    render(
      <SoundProvider>
        <TestConsumer />
      </SoundProvider>,
    );

    expect(screen.getByTestId("sound-status")).toHaveTextContent("disabled");
  });

  it("toggles sound preference and persists to localStorage", () => {
    render(
      <SoundProvider defaultEnabled={true}>
        <TestConsumer />
      </SoundProvider>,
    );

    const toggleBtn = screen.getByTestId("toggle-btn");

    fireEvent.click(toggleBtn);
    expect(screen.getByTestId("sound-status")).toHaveTextContent("disabled");
    expect(window.localStorage.getItem("worksphere-sound")).toBe("false");

    fireEvent.click(toggleBtn);
    expect(screen.getByTestId("sound-status")).toHaveTextContent("enabled");
    expect(window.localStorage.getItem("worksphere-sound")).toBe("true");
  });

  it("supports explicit setSoundEnabled calls", () => {
    render(
      <SoundProvider defaultEnabled={true}>
        <TestConsumer />
      </SoundProvider>,
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
      </SoundProvider>,
    );

    expect(screen.getByTestId("sound-status")).toHaveTextContent("disabled");

    fireEvent.click(screen.getByTestId("toggle-btn"));
    expect(screen.getByTestId("sound-status")).toHaveTextContent("enabled");
    expect(window.localStorage.getItem("custom-sound-key")).toBe("true");
  });

  it("handles localStorage read/write failures gracefully in private browsing", () => {
    const mockGetItem = jest
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new Error("SecurityError: Access is denied for this document");
      });
    const mockSetItem = jest
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("SecurityError: Access is denied for this document");
      });

    render(
      <SoundProvider defaultEnabled={true}>
        <TestConsumer />
      </SoundProvider>,
    );

    expect(screen.getByTestId("sound-status")).toHaveTextContent("enabled");

    expect(() =>
      fireEvent.click(screen.getByTestId("toggle-btn")),
    ).not.toThrow();
    expect(screen.getByTestId("sound-status")).toHaveTextContent("disabled");

    expect(() =>
      fireEvent.click(screen.getByTestId("enable-btn")),
    ).not.toThrow();
    expect(screen.getByTestId("sound-status")).toHaveTextContent("enabled");

    mockGetItem.mockRestore();
    mockSetItem.mockRestore();
  });

  it("synchronizes audio state across tabs via storage event", () => {
    render(
      <SoundProvider defaultEnabled={true}>
        <TestConsumer />
      </SoundProvider>,
    );

    expect(screen.getByTestId("sound-status")).toHaveTextContent("enabled");

    act(() => {
      const event = new StorageEvent("storage", {
        key: "worksphere-sound",
        newValue: "false",
      });
      window.dispatchEvent(event);
    });

    expect(screen.getByTestId("sound-status")).toHaveTextContent("disabled");

    act(() => {
      const event = new StorageEvent("storage", {
        key: "other-key",
        newValue: "true",
      });
      window.dispatchEvent(event);
    });

    expect(screen.getByTestId("sound-status")).toHaveTextContent("disabled");
  });

  describe("Bookmark Tactile Sound Effects (#7203)", () => {
    let mockOscillator: any;
    let mockGain: any;
    let mockContext: any;

    beforeEach(() => {
      mockOscillator = {
        type: "sine",
        frequency: {
          setValueAtTime: jest.fn(),
          exponentialRampToValueAtTime: jest.fn(),
        },
        connect: jest.fn(),
        start: jest.fn(),
        stop: jest.fn(),
      };
      mockGain = {
        gain: {
          setValueAtTime: jest.fn(),
          linearRampToValueAtTime: jest.fn(),
          exponentialRampToValueAtTime: jest.fn(),
        },
        connect: jest.fn(),
      };
      mockContext = {
        currentTime: 0,
        state: "running",
        destination: {},
        createOscillator: jest.fn(() => mockOscillator),
        createGain: jest.fn(() => mockGain),
        resume: jest.fn().mockResolvedValue(undefined),
        close: jest.fn().mockResolvedValue(undefined),
      };

      (window as any).AudioContext = jest.fn(() => mockContext);
    });

    afterEach(() => {
      delete (window as any).AudioContext;
      delete (window as any).webkitAudioContext;
    });

    it("synthesizes micro-acoustic chime via playBookmarkChime", () => {
      const result = playBookmarkChime(0.5);
      expect(result).toBe(true);
      expect(mockContext.createOscillator).toHaveBeenCalledTimes(2);
      expect(mockContext.createGain).toHaveBeenCalledTimes(1);
      expect(mockOscillator.start).toHaveBeenCalledTimes(2);
    });

    it("synthesizes soft low-frequency tone via playUnbookmarkTone", () => {
      const result = playUnbookmarkTone(0.5);
      expect(result).toBe(true);
      expect(mockContext.createOscillator).toHaveBeenCalledTimes(1);
      expect(mockContext.createGain).toHaveBeenCalledTimes(1);
      expect(mockOscillator.start).toHaveBeenCalledTimes(1);
    });

    it("silences feedback when volume is <= 0", () => {
      expect(playBookmarkChime(0)).toBe(false);
      expect(playUnbookmarkTone(-0.5)).toBe(false);
      expect(mockContext.createOscillator).not.toHaveBeenCalled();
    });

    it("returns false gracefully when AudioContext is unavailable in window", () => {
      delete (window as any).AudioContext;
      delete (window as any).webkitAudioContext;
      expect(playBookmarkChime(0.5)).toBe(false);
      expect(playUnbookmarkTone(0.5)).toBe(false);
    });

    it("allows useSound({ suppressError: true }) without throwing outside SoundProvider", () => {
      function SuppressedConsumer() {
        const sound = useSound({ suppressError: true });
        return (
          <span data-testid="suppressed-enabled">
            {String(sound.soundEnabled)}
          </span>
        );
      }

      render(<SuppressedConsumer />);
      expect(screen.getByTestId("suppressed-enabled")).toHaveTextContent(
        "false",
      );
    });

    it("triggers playBookmarkSound from SoundProvider context respecting global mute", () => {
      function SoundTriggerConsumer() {
        const { playBookmarkSound, setSoundEnabled } = useSound();
        return (
          <div>
            <button
              data-testid="play-bookmark"
              onClick={() => playBookmarkSound(true)}
            >
              Bookmark
            </button>
            <button
              data-testid="play-unbookmark"
              onClick={() => playBookmarkSound(false)}
            >
              Unbookmark
            </button>
            <button
              data-testid="mute-btn"
              onClick={() => setSoundEnabled(false)}
            >
              Mute
            </button>
          </div>
        );
      }

      render(
        <SoundProvider defaultEnabled={true}>
          <SoundTriggerConsumer />
        </SoundProvider>,
      );

      fireEvent.click(screen.getByTestId("play-bookmark"));
      expect(mockContext.createOscillator).toHaveBeenCalledTimes(2);

      jest.clearAllMocks();
      fireEvent.click(screen.getByTestId("play-unbookmark"));
      expect(mockContext.createOscillator).toHaveBeenCalledTimes(1);

      // Now mute globally
      fireEvent.click(screen.getByTestId("mute-btn"));
      jest.clearAllMocks();

      fireEvent.click(screen.getByTestId("play-bookmark"));
      expect(mockContext.createOscillator).not.toHaveBeenCalled();

      fireEvent.click(screen.getByTestId("play-unbookmark"));
      expect(mockContext.createOscillator).not.toHaveBeenCalled();
    });
  });
});
