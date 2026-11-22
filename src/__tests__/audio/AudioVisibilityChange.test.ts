import { renderHook, act } from "@testing-library/react";
import { ErgonomicChimeSynthesizer } from "@/lib/audio/ErgonomicChimeSynthesizer";
import { useAvionicsAudio } from "@/hooks/useAvionicsAudio";

describe("AudioContext tab visibility change handling", () => {
  let addEventListenerSpy: jest.SpyInstance;
  let removeEventListenerSpy: jest.SpyInstance;
  let visibilityStateGetter: jest.SpyInstance;

  beforeEach(() => {
    addEventListenerSpy = jest.spyOn(document, "addEventListener");
    removeEventListenerSpy = jest.spyOn(document, "removeEventListener");
    visibilityStateGetter = jest.spyOn(document, "visibilityState", "get");
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("ErgonomicChimeSynthesizer", () => {
    function createMockAudioContext(
      initialState: "running" | "suspended" = "suspended",
    ) {
      let state = initialState;
      const context = {
        get state() {
          return state;
        },
        currentTime: 0,
        destination: {},
        resume: jest.fn(async () => {
          state = "running";
        }),
        suspend: jest.fn(async () => {
          state = "suspended";
        }),
        close: jest.fn(async () => {
          state = "closed";
        }),
        createGain: jest.fn(() => ({
          gain: {
            setValueAtTime: jest.fn(),
            cancelScheduledValues: jest.fn(),
            exponentialRampToValueAtTime: jest.fn(),
          },
          connect: jest.fn(),
          disconnect: jest.fn(),
        })),
        createOscillator: jest.fn(() => ({
          type: "sine",
          frequency: { setValueAtTime: jest.fn() },
          connect: jest.fn(),
          disconnect: jest.fn(),
          start: jest.fn(),
          stop: jest.fn(),
          onended: null,
        })),
      };
      return context as unknown as AudioContext;
    }

    it("attaches visibilitychange listener and resumes suspended AudioContext when tab becomes visible", async () => {
      const mockContext = createMockAudioContext("suspended");
      const synth = new ErgonomicChimeSynthesizer({
        audioContextFactory: () => mockContext,
      });

      expect(addEventListenerSpy).toHaveBeenCalledWith(
        "visibilitychange",
        expect.any(Function),
      );

      // Trigger context creation by preparing or playing. prepare() resumes
      // the suspended context itself, so suspend it again (as the browser does
      // for a background tab) before testing the visibility handler.
      await synth.prepare();
      await (
        mockContext as unknown as { suspend: () => Promise<void> }
      ).suspend();
      (mockContext.resume as jest.Mock).mockClear();

      // Find the listener
      const listenerCall = addEventListenerSpy.mock.calls.find(
        (call) => call[0] === "visibilitychange",
      );
      expect(listenerCall).toBeDefined();
      const handler = listenerCall[1];

      // Simulate tab hidden
      visibilityStateGetter.mockReturnValue("hidden");
      await handler();
      expect(mockContext.resume).not.toHaveBeenCalled();

      // Simulate tab visible
      visibilityStateGetter.mockReturnValue("visible");
      await handler();
      expect(mockContext.resume).toHaveBeenCalledTimes(1);
    });

    it("cleans up visibilitychange listener on dispose", async () => {
      const synth = new ErgonomicChimeSynthesizer();
      await synth.dispose();

      expect(removeEventListenerSpy).toHaveBeenCalledWith(
        "visibilitychange",
        expect.any(Function),
      );
    });
  });

  describe("useAvionicsAudio", () => {
    it("attaches visibilitychange listener and cleans it up on unmount", () => {
      const { unmount } = renderHook(() => useAvionicsAudio());

      expect(addEventListenerSpy).toHaveBeenCalledWith(
        "visibilitychange",
        expect.any(Function),
      );

      unmount();

      expect(removeEventListenerSpy).toHaveBeenCalledWith(
        "visibilitychange",
        expect.any(Function),
      );
    });
  });
  it("queues a caution until a suspended AudioContext resumes after a user gesture", async () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(
      window,
      "AudioContext",
    );

    let state: AudioContextState = "suspended";

    const createAudioParam = () => ({
      setValueAtTime: jest.fn(),
      exponentialRampToValueAtTime: jest.fn(),
      cancelScheduledValues: jest.fn(),
    });

    const oscillatorStart = jest.fn();
    const resume = jest.fn(async () => {
      state = "running";
    });
    const close = jest.fn(async () => {
      state = "closed";
    });

    const mockContext = {
      get state() {
        return state;
      },
      currentTime: 0,
      destination: {},
      resume,
      close,
      createDynamicsCompressor: jest.fn(() => ({
        threshold: createAudioParam(),
        knee: createAudioParam(),
        ratio: createAudioParam(),
        attack: createAudioParam(),
        release: createAudioParam(),
        connect: jest.fn(),
      })),
      createGain: jest.fn(() => ({
        gain: createAudioParam(),
        connect: jest.fn(),
        disconnect: jest.fn(),
      })),
      createBiquadFilter: jest.fn(() => ({
        type: "lowpass",
        frequency: createAudioParam(),
        Q: createAudioParam(),
        connect: jest.fn(),
      })),
      createOscillator: jest.fn(() => ({
        type: "square",
        frequency: createAudioParam(),
        connect: jest.fn(),
        start: oscillatorStart,
        stop: jest.fn(),
        disconnect: jest.fn(),
      })),
    } as unknown as AudioContext;

    let unmount: (() => void) | undefined;

    try {
      Object.defineProperty(window, "AudioContext", {
        configurable: true,
        writable: true,
        value: jest.fn(() => mockContext),
      });

      const rendered = renderHook(() => useAvionicsAudio());
      unmount = rendered.unmount;

      // Playback is queued while the context is suspended.
      act(() => {
        expect(rendered.result.current.playMasterCaution()).toBe(false);
      });

      expect(resume).not.toHaveBeenCalled();
      expect(oscillatorStart).not.toHaveBeenCalled();

      // A user gesture resumes the context and triggers queued playback.
      await act(async () => {
        window.dispatchEvent(new Event("pointerdown"));
        await Promise.resolve();
      });

      expect(resume).toHaveBeenCalledTimes(1);
      expect(rendered.result.current.isAudioUnlocked).toBe(true);
      expect(oscillatorStart).toHaveBeenCalledTimes(4);

      // Further gestures must not replay the consumed request.
      await act(async () => {
        window.dispatchEvent(new Event("pointerdown"));
        await Promise.resolve();
      });

      expect(oscillatorStart).toHaveBeenCalledTimes(4);
    } finally {
      unmount?.();
      await close();

      if (originalDescriptor) {
        Object.defineProperty(window, "AudioContext", originalDescriptor);
      } else {
        Reflect.deleteProperty(window, "AudioContext");
      }
    }
  });
});
