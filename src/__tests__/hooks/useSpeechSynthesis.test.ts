import { renderHook, act } from "@testing-library/react";
import {
  useSpeechSynthesis,
  splitTextIntoSentences,
  SPEED_OPTIONS,
} from "@/hooks/useSpeechSynthesis";

describe("splitTextIntoSentences", () => {
  it("splits text into sentences by punctuation boundaries", () => {
    const text = "Hello world! This is a test. How are you doing today?";
    const sentences = splitTextIntoSentences(text);
    expect(sentences).toEqual([
      "Hello world!",
      "This is a test.",
      "How are you doing today?",
    ]);
  });

  it("strips UI components from text before splitting", () => {
    const text =
      'Found 3 cafes.<ui-component name="Map" props=\'{}\' /> 1. Cafe Central is quiet.';
    const sentences = splitTextIntoSentences(text);
    expect(sentences).toEqual(["Found 3 cafes.", "1. Cafe Central is quiet."]);
  });
});

describe("useSpeechSynthesis hook", () => {
  let mockSpeak: jest.Mock;
  let mockCancel: jest.Mock;
  let mockPause: jest.Mock;
  let mockResume: jest.Mock;
  let mockGetVoices: jest.Mock;
  let createdUtterances: any[] = [];

  class MockSpeechSynthesisUtterance {
    text: string;
    rate: number = 1;
    pitch: number = 1;
    lang: string = "";
    voice: any = null;
    onstart: (() => void) | null = null;
    onend: (() => void) | null = null;
    onerror: ((e: any) => void) | null = null;
    onpause: (() => void) | null = null;
    onresume: (() => void) | null = null;

    constructor(text?: string) {
      this.text = text || "";
      createdUtterances.push(this);
    }
  }

  beforeEach(() => {
    createdUtterances = [];
    mockSpeak = jest.fn();
    mockCancel = jest.fn();
    mockPause = jest.fn();
    mockResume = jest.fn();
    mockGetVoices = jest.fn().mockReturnValue([
      { name: "English Voice", lang: "en-US", default: true },
      { name: "Spanish Voice", lang: "es-ES", default: false },
    ]);

    Object.defineProperty(window, "SpeechSynthesisUtterance", {
      value: MockSpeechSynthesisUtterance,
      writable: true,
      configurable: true,
    });

    Object.defineProperty(window, "speechSynthesis", {
      value: {
        speak: mockSpeak,
        cancel: mockCancel,
        pause: mockPause,
        resume: mockResume,
        getVoices: mockGetVoices,
        onvoiceschanged: null,
      },
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("exports standard speed options (0.75x to 2x including 1x, 1.25x, 1.5x)", () => {
    expect(SPEED_OPTIONS).toEqual([0.75, 1, 1.25, 1.5, 1.75, 2]);
  });

  it("detects browser support correctly", () => {
    const { result } = renderHook(() => useSpeechSynthesis("Hello world"));
    expect(result.current.isSupported).toBe(true);
  });

  it("handles unsupported browser environments gracefully", () => {
    const originalSynthesis = window.speechSynthesis;
    // @ts-expect-error test cleanup
    delete window.speechSynthesis;

    const { result } = renderHook(() => useSpeechSynthesis("Hello world"));
    expect(result.current.isSupported).toBe(false);

    act(() => {
      result.current.speak();
    });

    expect(result.current.error).toMatch(/not supported/i);

    window.speechSynthesis = originalSynthesis;
  });

  it("passes default rate (1x) and pitch to SpeechSynthesisUtterance instance", () => {
    const { result } = renderHook(() =>
      useSpeechSynthesis("Testing speech synthesis", {
        defaultRate: 1,
        defaultPitch: 1,
      }),
    );

    act(() => {
      result.current.speak();
    });

    expect(mockSpeak).toHaveBeenCalledTimes(1);
    expect(createdUtterances.length).toBe(1);
    const utterance = createdUtterances[0];
    expect(utterance.text).toBe("Testing speech synthesis");
    expect(utterance.rate).toBe(1);
    expect(utterance.pitch).toBe(1);
  });

  it("updates rate state and passes rate parameter (1.25x, 1.5x) to utterance", () => {
    const { result } = renderHook(() => useSpeechSynthesis("Speed test"));

    act(() => {
      result.current.setRate(1.25);
    });
    expect(result.current.rate).toBe(1.25);

    act(() => {
      result.current.speak();
    });

    expect(createdUtterances[createdUtterances.length - 1].rate).toBe(1.25);

    act(() => {
      result.current.setRate(1.5);
    });
    expect(result.current.rate).toBe(1.5);

    act(() => {
      result.current.speak();
    });

    expect(createdUtterances[createdUtterances.length - 1].rate).toBe(1.5);
  });

  it("clamps playback rate between 0.75x and 2.0x", () => {
    const { result } = renderHook(() => useSpeechSynthesis("Clamp test"));

    act(() => {
      result.current.setRate(0.1);
    });
    expect(result.current.rate).toBe(0.75);

    act(() => {
      result.current.setRate(5.0);
    });
    expect(result.current.rate).toBe(2);
  });

  it("updates pitch state correctly", () => {
    const { result } = renderHook(() => useSpeechSynthesis("Pitch test"));

    act(() => {
      result.current.setPitch(1.5);
    });
    expect(result.current.pitch).toBe(1.5);

    act(() => {
      result.current.speak();
    });

    expect(createdUtterances[createdUtterances.length - 1].pitch).toBe(1.5);
  });

  it("triggers onStart and onEnd callbacks through utterance events", () => {
    const onStart = jest.fn();
    const onEnd = jest.fn();
    const { result } = renderHook(() =>
      useSpeechSynthesis("Callback test", { onStart, onEnd }),
    );

    act(() => {
      result.current.speak();
    });

    const utterance = createdUtterances[0];

    act(() => {
      utterance.onstart?.();
    });

    expect(result.current.isSpeaking).toBe(true);
    expect(onStart).toHaveBeenCalled();

    act(() => {
      utterance.onend?.();
    });

    expect(result.current.isSpeaking).toBe(false);
    expect(onEnd).toHaveBeenCalled();
  });

  it("calls cancel, pause, and resume correctly", () => {
    const { result } = renderHook(() => useSpeechSynthesis("Control test"));

    act(() => {
      result.current.cancel();
    });
    expect(mockCancel).toHaveBeenCalled();

    act(() => {
      result.current.pause();
    });
    expect(mockPause).toHaveBeenCalled();

    act(() => {
      result.current.resume();
    });
    expect(mockResume).toHaveBeenCalled();
  });

  it("handles speakMessage with sentence tracking and playback rate", () => {
    const { result } = renderHook(() => useSpeechSynthesis());

    act(() => {
      result.current.setRate(1.25);
    });

    act(() => {
      result.current.speakMessage("msg-101", "First sentence. Second sentence.");
    });

    expect(mockCancel).toHaveBeenCalled();
    expect(mockSpeak).toHaveBeenCalledTimes(2);
    expect(createdUtterances[createdUtterances.length - 2].rate).toBe(1.25);
    expect(createdUtterances[createdUtterances.length - 1].rate).toBe(1.25);

    act(() => {
      result.current.stopSpeech();
    });

    expect(result.current.speakingMessageId).toBeNull();
  });
});
