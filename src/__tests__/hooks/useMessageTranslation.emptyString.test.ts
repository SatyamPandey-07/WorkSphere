import "@testing-library/jest-dom";
import { renderHook, act } from "@testing-library/react";
import { useMessageTranslation, translateMessage } from "@/hooks/useMessageTranslation";

jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    i18n: { language: "es-ES", resolvedLanguage: "es" },
  }),
}));

describe("useMessageTranslation - Empty String & Whitespace Handling (#5596)", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = jest.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.clearAllMocks();
  });

  it("does not trigger network fetch when translating empty string", async () => {
    const { result } = renderHook(() =>
      useMessageTranslation("msg-empty", "")
    );

    await act(async () => {
      await result.current.translate();
    });

    expect(global.fetch).not.toHaveBeenCalled();
    expect(result.current.translation).toEqual({
      translatedText: "",
      sourceLanguage: "Unknown",
    });
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("does not trigger network fetch when translating whitespace-only message", async () => {
    const { result } = renderHook(() =>
      useMessageTranslation("msg-whitespace", "   \t\n  ")
    );

    await act(async () => {
      await result.current.translate();
    });

    expect(global.fetch).not.toHaveBeenCalled();
    expect(result.current.translation).toEqual({
      translatedText: "",
      sourceLanguage: "Unknown",
    });
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("translateMessage standalone helper returns empty string immediately without fetch", async () => {
    const resEmpty = await translateMessage("", "fr");
    expect(resEmpty).toEqual({ translatedText: "", sourceLanguage: "Unknown" });

    const resSpaces = await translateMessage("   ", "de");
    expect(resSpaces).toEqual({ translatedText: "", sourceLanguage: "Unknown" });

    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("fires network request for non-empty text", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        translatedText: "Hola",
        sourceLanguage: "en",
      }),
    });

    const { result } = renderHook(() =>
      useMessageTranslation("msg-valid", "Hello")
    );

    await act(async () => {
      await result.current.translate();
    });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(result.current.translation?.translatedText).toBe("Hola");
  });
});
