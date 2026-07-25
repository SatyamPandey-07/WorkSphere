import { act, renderHook } from "@testing-library/react";
import { useSpeechRecognition } from "@/hooks/useSpeechRecognition";

describe("useSpeechRecognition media track cleanup", () => {
  const stop = jest.fn();
  let recognitionInstance: {
    start: jest.Mock;
    stop: jest.Mock;
    abort: jest.Mock;
    onstart: ((ev: Event) => void) | null;
    onend: ((ev: Event) => void) | null;
    onresult: ((ev: unknown) => void) | null;
    onerror: ((ev: unknown) => void) | null;
    lang: string;
    interimResults: boolean;
    maxAlternatives: number;
    continuous: boolean;
  };

  beforeEach(() => {
    stop.mockClear();
    recognitionInstance = {
      start: jest.fn(),
      stop: jest.fn(),
      abort: jest.fn(),
      onstart: null,
      onend: null,
      onresult: null,
      onerror: null,
      lang: "",
      interimResults: false,
      maxAlternatives: 1,
      continuous: false,
    };

    (window as unknown as { SpeechRecognition: unknown }).SpeechRecognition =
      jest.fn(() => recognitionInstance);

    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: jest.fn().mockResolvedValue({
          getTracks: () => [{ stop }, { stop }],
        }),
      },
    });
  });

  afterEach(() => {
    delete (window as unknown as { SpeechRecognition?: unknown })
      .SpeechRecognition;
  });

  it("stops all MediaStream tracks when dictation ends", async () => {
    const { result } = renderHook(() => useSpeechRecognition(jest.fn()));

    await act(async () => {
      await result.current.startListening();
    });

    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({
      audio: true,
    });

    act(() => {
      result.current.stopListening();
    });

    expect(stop).toHaveBeenCalledTimes(2);
  });
});
