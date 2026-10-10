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
});
