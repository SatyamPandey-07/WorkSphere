import { renderHook, act } from "@testing-library/react";
import { useSpeechQueue } from "@/hooks/useSpeechQueue";

// Mock useSpeechSynthesis so we can control state transitions
const cancelMock = jest.fn();
const speakMessageMock = jest.fn();
const setRateMock = jest.fn();
const setVoiceMock = jest.fn();

jest.mock("@/hooks/useSpeechSynthesis", () => ({
  useSpeechSynthesis: () => ({
    isSpeaking: false,
    speakMessage: speakMessageMock,
    cancel: cancelMock,
    rate: 1,
    setRate: setRateMock,
    voices: [],
    voice: null,
    setVoice: setVoiceMock,
    isSupported: true,
  }),
}));

beforeEach(() => {
  jest.clearAllMocks();
});

describe("useSpeechQueue", () => {
  it("starts with an empty queue", () => {
    const { result } = renderHook(() => useSpeechQueue());
    expect(result.current.queueLength).toBe(0);
    expect(result.current.isSpeaking).toBe(false);
  });

  it("increments queueLength when enqueue is called", () => {
    const { result } = renderHook(() => useSpeechQueue());
    act(() => {
      result.current.enqueue("Hello");
    });
    expect(result.current.queueLength).toBe(1);
  });

  it("increments queueLength for each enqueue call", () => {
    const { result } = renderHook(() => useSpeechQueue());
    act(() => {
      result.current.enqueue("First");
      result.current.enqueue("Second");
      result.current.enqueue("Third");
    });
    expect(result.current.queueLength).toBe(3);
  });

  it("clearQueue empties the queue and calls cancel", () => {
    const { result } = renderHook(() => useSpeechQueue());
    act(() => {
      result.current.enqueue("Test 1");
      result.current.enqueue("Test 2");
    });
    expect(result.current.queueLength).toBe(2);

    act(() => {
      result.current.clearQueue();
    });

    expect(result.current.queueLength).toBe(0);
    expect(cancelMock).toHaveBeenCalled();
  });

  it("playNext calls cancel and decrements queue", () => {
    const { result } = renderHook(() => useSpeechQueue());
    act(() => {
      result.current.enqueue("First");
      result.current.enqueue("Second");
    });

    act(() => {
      result.current.playNext();
    });

    expect(cancelMock).toHaveBeenCalled();
    expect(result.current.queueLength).toBe(1);
  });

  it("respects maxQueueLength by dropping oldest entries", () => {
    const { result } = renderHook(() => useSpeechQueue({ maxQueueLength: 2 }));
    act(() => {
      result.current.enqueue("First");
      result.current.enqueue("Second");
      result.current.enqueue("Third"); // Should drop "First"
    });
    expect(result.current.queueLength).toBe(2);
  });

  it("dequeue returns the next message without calling speakMessage", () => {
    const { result } = renderHook(() => useSpeechQueue());
    act(() => {
      result.current.enqueue("Dequeue me");
    });

    let dequeued: string | undefined;
    act(() => {
      dequeued = result.current.dequeue();
    });

    expect(dequeued).toBe("Dequeue me");
    expect(result.current.queueLength).toBe(0);
    expect(speakMessageMock).not.toHaveBeenCalled();
  });

  it("passes rate and setRate from underlying useSpeechSynthesis", () => {
    const { result } = renderHook(() => useSpeechQueue());
    expect(result.current.rate).toBe(1);
    act(() => {
      result.current.setRate(1.5);
    });
    expect(setRateMock).toHaveBeenCalledWith(1.5);
  });
});
