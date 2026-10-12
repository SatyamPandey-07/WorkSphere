import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { TranslatedMessage } from "@/components/chat/TranslatedMessage";

jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    i18n: { language: "fr-FR", resolvedLanguage: "fr" },
  }),
}));

describe("TranslatedMessage", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.clearAllMocks();
  });

  it("toggles between translated text and the original message", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        translatedText: "Hola mundo",
        sourceLanguage: "English",
      }),
    }) as jest.Mock;

    render(<TranslatedMessage messageId="message-1" text="Hello world" />);

    fireEvent.click(screen.getByRole("button", { name: "Translate message" }));

    expect(await screen.findByText("Hola mundo")).toBeInTheDocument();
    expect(screen.getByText("Translated from English")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Show original message" }));
    expect(screen.getByText("Hello world")).toBeInTheDocument();
    expect(screen.queryByText("Hola mundo")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Show translated message" }));
    expect(screen.getByText("Hola mundo")).toBeInTheDocument();
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
  });

  it("renders fallback label 'Auto-detected' when sourceLanguage is undefined, null, or 'Unknown'", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        translatedText: "Bonjour le monde",
        sourceLanguage: undefined,
      }),
    }) as jest.Mock;

    render(<TranslatedMessage messageId="message-2" text="Hello world" />);

    fireEvent.click(screen.getByRole("button", { name: "Translate message" }));

    expect(await screen.findByText("Bonjour le monde")).toBeInTheDocument();
    expect(screen.getByText("Auto-detected")).toBeInTheDocument();
    expect(screen.queryByText(/undefined/i)).not.toBeInTheDocument();
  });

  it("renders fallback label 'Auto-detected' when sourceLanguage is 'Unknown'", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        translatedText: "Ciao mondo",
        sourceLanguage: "Unknown",
      }),
    }) as jest.Mock;

    render(<TranslatedMessage messageId="message-3" text="Hello world" />);

    fireEvent.click(screen.getByRole("button", { name: "Translate message" }));

    expect(await screen.findByText("Ciao mondo")).toBeInTheDocument();
    expect(screen.getByText("Auto-detected")).toBeInTheDocument();
  });

  it("toggles side-by-side view mode and persists preference to localStorage (#5765)", async () => {
    localStorage.clear();
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        translatedText: "Guten Tag",
        sourceLanguage: "German",
      }),
    }) as jest.Mock;

    render(<TranslatedMessage messageId="message-4" text="Good afternoon" />);

    fireEvent.click(screen.getByRole("button", { name: "Translate message" }));
    expect(await screen.findByText("Guten Tag")).toBeInTheDocument();

    // Default view: dual text layout is not present
    expect(screen.queryByTestId("dual-text-layout")).not.toBeInTheDocument();

    // Toggle side-by-side view mode
    const toggleBtn = screen.getByRole("button", { name: "Switch to side-by-side view" });
    fireEvent.click(toggleBtn);

    // Dual-text layout renders both original and translated text
    const dualLayout = screen.getByTestId("dual-text-layout");
    expect(dualLayout).toBeInTheDocument();
    expect(screen.getByText("Good afternoon")).toBeInTheDocument();
    expect(screen.getByText("Guten Tag")).toBeInTheDocument();
    expect(localStorage.getItem("worksphere-translation-view-mode")).toBe("dual");

    // Toggle back to single view
    fireEvent.click(screen.getByRole("button", { name: "Switch to single message view" }));
    expect(screen.queryByTestId("dual-text-layout")).not.toBeInTheDocument();
    expect(localStorage.getItem("worksphere-translation-view-mode")).toBe("single");
  });

  it("initializes in dual side-by-side mode if stored in localStorage (#5765)", async () => {
    localStorage.setItem("worksphere-translation-view-mode", "dual");
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        translatedText: "Bonjour",
        sourceLanguage: "French",
      }),
    }) as jest.Mock;

    render(<TranslatedMessage messageId="message-5" text="Hello" />);

    fireEvent.click(screen.getByRole("button", { name: "Translate message" }));
    expect(await screen.findByText("Bonjour")).toBeInTheDocument();

    // Dual-text layout renders immediately
    expect(screen.getByTestId("dual-text-layout")).toBeInTheDocument();
    expect(screen.getByText("Hello")).toBeInTheDocument();
    expect(screen.getByText("Bonjour")).toBeInTheDocument();
  });
});