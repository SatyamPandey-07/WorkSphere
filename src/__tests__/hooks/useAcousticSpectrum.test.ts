import { renderHook, act } from "@testing-library/react";
import {
  useAcousticSpectrum,
  attachAutoResumeListeners,
  AUDIO_RESUME_INTERACTION_EVENTS,
} from "@/hooks/useAcousticSpectrum";

describe("useAcousticSpectrum & attachAutoResumeListeners (#7766)", () => {
  let mockAudioContext: any;
  let addEventListenerSpy: jest.SpyInstance;
  let removeEventListenerSpy: jest.SpyInstance;

  beforeEach(() => {
    mockAudioContext = {
      state: "suspended",
      resume: jest.fn().mockImplementation(async () => {
        mockAudioContext.state = "running";
      }),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
    };

    addEventListenerSpy = jest.spyOn(window, "addEventListener");
    removeEventListenerSpy = jest.spyOn(window, "removeEventListener");
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("AUDIO_RESUME_INTERACTION_EVENTS", () => {
    it("contains click, keydown, and touchstart interaction events", () => {
      expect(AUDIO_RESUME_INTERACTION_EVENTS).toContain("click");
      expect(AUDIO_RESUME_INTERACTION_EVENTS).toContain("keydown");
      expect(AUDIO_RESUME_INTERACTION_EVENTS).toContain("touchstart");
      expect(AUDIO_RESUME_INTERACTION_EVENTS).toHaveLength(3);
    });
  });

  describe("attachAutoResumeListeners", () => {
    it("registers click, keydown, and touchstart listeners on suspended AudioContext", () => {
      const cleanup = attachAutoResumeListeners(mockAudioContext);

      expect(addEventListenerSpy).toHaveBeenCalledWith(
        "click",
        expect.any(Function),
      );
      expect(addEventListenerSpy).toHaveBeenCalledWith(
        "keydown",
        expect.any(Function),
      );
      expect(addEventListenerSpy).toHaveBeenCalledWith(
        "touchstart",
        expect.any(Function),
        { passive: true },
      );
      expect(mockAudioContext.addEventListener).toHaveBeenCalledWith(
        "statechange",
        expect.any(Function),
      );

      cleanup();
    });

    it("does not register listeners when context is already running", () => {
      mockAudioContext.state = "running";
      const cleanup = attachAutoResumeListeners(mockAudioContext);

      expect(addEventListenerSpy).not.toHaveBeenCalled();
      expect(mockAudioContext.addEventListener).not.toHaveBeenCalled();

      cleanup();
    });

    it("does not register listeners when context is closed or null", () => {
      mockAudioContext.state = "closed";
      const cleanupClosed = attachAutoResumeListeners(mockAudioContext);
      const cleanupNull = attachAutoResumeListeners(null);

      expect(addEventListenerSpy).not.toHaveBeenCalled();

      cleanupClosed();
      cleanupNull();
    });

    it("resumes context and cleans up listeners upon click interaction", async () => {
      const onResumed = jest.fn();
      attachAutoResumeListeners(mockAudioContext, onResumed);

      const clickCall = addEventListenerSpy.mock.calls.find(
        (call) => call[0] === "click",
      );
      expect(clickCall).toBeDefined();
      const clickHandler = clickCall[1];

      await clickHandler();

      expect(mockAudioContext.resume).toHaveBeenCalledTimes(1);
      expect(mockAudioContext.state).toBe("running");
      expect(onResumed).toHaveBeenCalledTimes(1);

      expect(removeEventListenerSpy).toHaveBeenCalledWith(
        "click",
        clickHandler,
      );
      expect(removeEventListenerSpy).toHaveBeenCalledWith(
        "keydown",
        expect.any(Function),
      );
      expect(removeEventListenerSpy).toHaveBeenCalledWith(
        "touchstart",
        expect.any(Function),
      );
      expect(mockAudioContext.removeEventListener).toHaveBeenCalledWith(
        "statechange",
        expect.any(Function),
      );
    });

    it("resumes context and cleans up listeners upon keydown interaction", async () => {
      attachAutoResumeListeners(mockAudioContext);

      const keydownCall = addEventListenerSpy.mock.calls.find(
        (call) => call[0] === "keydown",
      );
      expect(keydownCall).toBeDefined();
      const keydownHandler = keydownCall[1];

      await keydownHandler();

      expect(mockAudioContext.resume).toHaveBeenCalledTimes(1);
      expect(removeEventListenerSpy).toHaveBeenCalledWith(
        "keydown",
        keydownHandler,
      );
    });

    it("resumes context and cleans up listeners upon touchstart interaction", async () => {
      attachAutoResumeListeners(mockAudioContext);

      const touchCall = addEventListenerSpy.mock.calls.find(
        (call) => call[0] === "touchstart",
      );
      expect(touchCall).toBeDefined();
      const touchHandler = touchCall[1];

      await touchHandler();

      expect(mockAudioContext.resume).toHaveBeenCalledTimes(1);
      expect(removeEventListenerSpy).toHaveBeenCalledWith(
        "touchstart",
        touchHandler,
      );
    });

    it("prevents duplicate concurrent resume calls when touchstart and click fire consecutively", async () => {
      let resolveResume: () => void;
      mockAudioContext.resume = jest.fn().mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            resolveResume = () => {
              mockAudioContext.state = "running";
              resolve();
            };
          }),
      );

      attachAutoResumeListeners(mockAudioContext);

      const touchCall = addEventListenerSpy.mock.calls.find(
        (call) => call[0] === "touchstart",
      );
      const clickCall = addEventListenerSpy.mock.calls.find(
        (call) => call[0] === "click",
      );

      const p1 = touchCall[1]();
      const p2 = clickCall[1]();

      resolveResume!();
      await Promise.all([p1, p2]);

      expect(mockAudioContext.resume).toHaveBeenCalledTimes(1);
    });

    it("handles resume promise rejection gracefully without unhandled rejections", async () => {
      mockAudioContext.resume = jest
        .fn()
        .mockRejectedValue(
          new DOMException("Autoplay blocked", "NotAllowedError"),
        );

      attachAutoResumeListeners(mockAudioContext);

      const clickCall = addEventListenerSpy.mock.calls.find(
        (call) => call[0] === "click",
      );
      const clickHandler = clickCall[1];

      await expect(clickHandler()).resolves.toBeUndefined();
      expect(mockAudioContext.resume).toHaveBeenCalledTimes(1);
    });

    it("handles synchronous errors thrown in resume gracefully", async () => {
      mockAudioContext.resume = jest.fn().mockImplementation(() => {
        throw new Error("Synchronous resume exception");
      });

      attachAutoResumeListeners(mockAudioContext);

      const clickCall = addEventListenerSpy.mock.calls.find(
        (call) => call[0] === "click",
      );
      const clickHandler = clickCall[1];

      await expect(clickHandler()).resolves.toBeUndefined();
      expect(mockAudioContext.resume).toHaveBeenCalledTimes(1);
    });

    it("manually calling cleanup removes all registered interaction listeners", () => {
      const cleanup = attachAutoResumeListeners(mockAudioContext);

      cleanup();

      expect(removeEventListenerSpy).toHaveBeenCalledWith(
        "click",
        expect.any(Function),
      );
      expect(removeEventListenerSpy).toHaveBeenCalledWith(
        "keydown",
        expect.any(Function),
      );
      expect(removeEventListenerSpy).toHaveBeenCalledWith(
        "touchstart",
        expect.any(Function),
      );
      expect(mockAudioContext.removeEventListener).toHaveBeenCalledWith(
        "statechange",
        expect.any(Function),
      );
    });
  });

  describe("useAcousticSpectrum Hook", () => {
    it("initializes in uninitialized state when no AudioContext is provided", () => {
      const { result } = renderHook(() => useAcousticSpectrum());

      expect(result.current.audioState).toBe("uninitialized");
      expect(result.current.isResumed).toBe(false);
      expect(result.current.audioContext).toBeNull();
      expect(addEventListenerSpy).not.toHaveBeenCalled();
    });

    it("initializes in running state without attaching listeners when context is already running", () => {
      mockAudioContext.state = "running";
      const { result } = renderHook(() =>
        useAcousticSpectrum({ audioContext: mockAudioContext }),
      );

      expect(result.current.audioState).toBe("running");
      expect(result.current.isResumed).toBe(true);
      expect(addEventListenerSpy).not.toHaveBeenCalled();
    });

    it("attaches one-time interaction listeners when context is suspended", () => {
      const { result } = renderHook(() =>
        useAcousticSpectrum({ audioContext: mockAudioContext }),
      );

      expect(result.current.audioState).toBe("suspended");
      expect(result.current.isResumed).toBe(false);
      expect(addEventListenerSpy).toHaveBeenCalledWith(
        "click",
        expect.any(Function),
      );
      expect(addEventListenerSpy).toHaveBeenCalledWith(
        "keydown",
        expect.any(Function),
      );
      expect(addEventListenerSpy).toHaveBeenCalledWith(
        "touchstart",
        expect.any(Function),
        {
          passive: true,
        },
      );
    });

    it("accepts AudioContext directly as first argument", () => {
      const { result } = renderHook(() =>
        useAcousticSpectrum(mockAudioContext),
      );

      expect(result.current.audioContext).toBe(mockAudioContext);
      expect(result.current.audioState).toBe("suspended");
      expect(addEventListenerSpy).toHaveBeenCalledWith(
        "click",
        expect.any(Function),
      );
    });

    it("does not attach autoResume listeners if autoResume is false", () => {
      const { result } = renderHook(() =>
        useAcousticSpectrum({
          audioContext: mockAudioContext,
          autoResume: false,
        }),
      );

      expect(result.current.audioState).toBe("suspended");
      expect(addEventListenerSpy).not.toHaveBeenCalled();
    });

    it("resumes context and updates state when user interacts", async () => {
      const onStateChange = jest.fn();
      const { result } = renderHook(() =>
        useAcousticSpectrum({ audioContext: mockAudioContext, onStateChange }),
      );

      const clickCall = addEventListenerSpy.mock.calls.find(
        (call) => call[0] === "click",
      );
      const clickHandler = clickCall[1];

      await act(async () => {
        await clickHandler();
      });

      expect(mockAudioContext.resume).toHaveBeenCalledTimes(1);
      expect(result.current.audioState).toBe("running");
      expect(result.current.isResumed).toBe(true);
      expect(onStateChange).toHaveBeenCalledWith("running");
      expect(removeEventListenerSpy).toHaveBeenCalledWith(
        "click",
        clickHandler,
      );
    });

    it("cleans up interaction listeners on hook unmount", () => {
      const { unmount } = renderHook(() =>
        useAcousticSpectrum({ audioContext: mockAudioContext }),
      );

      unmount();

      expect(removeEventListenerSpy).toHaveBeenCalledWith(
        "click",
        expect.any(Function),
      );
      expect(removeEventListenerSpy).toHaveBeenCalledWith(
        "keydown",
        expect.any(Function),
      );
      expect(removeEventListenerSpy).toHaveBeenCalledWith(
        "touchstart",
        expect.any(Function),
      );
    });

    it("manual resumeAudio() call resumes context and updates state", async () => {
      const { result } = renderHook(() =>
        useAcousticSpectrum({ audioContext: mockAudioContext }),
      );

      await act(async () => {
        await result.current.resumeAudio();
      });

      expect(mockAudioContext.resume).toHaveBeenCalled();
      expect(result.current.audioState).toBe("running");
      expect(result.current.isResumed).toBe(true);
    });

    it("getFrequencyData reads from analyserNode or returns empty array", () => {
      const mockAnalyser = {
        frequencyBinCount: 4,
        getFloatFrequencyData: jest.fn((arr: Float32Array) => {
          arr[0] = -30;
          arr[1] = -40;
          arr[2] = -50;
          arr[3] = -60;
        }),
      } as unknown as AnalyserNode;

      const { result, rerender } = renderHook(
        ({ analyser }) =>
          useAcousticSpectrum({
            audioContext: mockAudioContext,
            analyserNode: analyser,
          }),
        { initialProps: { analyser: null as AnalyserNode | null } },
      );

      expect(result.current.getFrequencyData()).toHaveLength(0);

      rerender({ analyser: mockAnalyser });
      const data = result.current.getFrequencyData();
      expect(data).toHaveLength(4);
      expect(data[0]).toBe(-30);
    });
  });
});
