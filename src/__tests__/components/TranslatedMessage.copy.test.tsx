import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { TranslatedMessage } from "@/components/chat/TranslatedMessage";
import * as useMessageTranslationModule from "@/hooks/useMessageTranslation";

describe("TranslatedMessage Copy Button (#5630)", () => {
  const mockTranslate = vi.fn();
  const mockToggleOriginal = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    // Mock clipboard writeText
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders copy button beside translated text and triggers clipboard writeText with tooltip confirmation", async () => {
    vi.spyOn(useMessageTranslationModule, "useMessageTranslation").mockReturnValue({
      translation: {
        messageId: "msg-1",
        originalText: "Hola mundo",
        translatedText: "Hello world",
        sourceLanguage: "es",
        targetLanguage: "en",
        detectedLanguage: "es",
        confidence: 0.99,
        cached: false,
      },
      error: null,
      isLoading: false,
      showOriginal: false,
      translate: mockTranslate,
      toggleOriginal: mockToggleOriginal,
    });

    render(<TranslatedMessage messageId="msg-1" text="Hola mundo" />);

    const copyBtn = screen.getByRole("button", { name: "Copy translated text" });
    expect(copyBtn).toBeInTheDocument();

    // Click copy button
    await act(async () => {
      fireEvent.click(copyBtn);
    });

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("Hello world");

    // Tooltip should appear
    expect(screen.getByRole("status")).toHaveTextContent("Copied!");

    // After 2 seconds, tooltip reverts
    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
