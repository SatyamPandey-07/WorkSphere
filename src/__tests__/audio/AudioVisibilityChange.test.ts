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
    function createMockAudioContext(initialState: "running" | "suspended" = "suspended") {
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

      // Trigger context creation by preparing or playing
      await synth.prepare();

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
});
