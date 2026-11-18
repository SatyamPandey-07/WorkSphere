import React from "react";
import { render, screen, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import { I18nProvider, i18n } from "@/components/I18nProvider";
import DefaultI18nProvider from "@/components/I18nProvider";
import { useTranslation } from "react-i18next";

jest.mock("@/hooks/useCsrfToken", () => ({
  useCsrfToken: jest.fn(),
}));

function ConsumerComponent() {
  const { t, i18n: localI18n } = useTranslation();
  return (
    <div>
      <span data-testid="current-lang">{localI18n.language}</span>
      <span data-testid="translated-title">{t("dashboard.title", "WorkSphere Dashboard")}</span>
      <span data-testid="fallback-translation">{t("nonexistent.key.xyz", "Default Fallback Text")}</span>
    </div>
  );
}

describe("I18nProvider Component (#6935)", () => {
  beforeEach(async () => {
    await act(async () => {
      await i18n.changeLanguage("en");
    });
  });

  it("renders children and provides i18next context", () => {
    render(
      <I18nProvider>
        <ConsumerComponent />
      </I18nProvider>
    );

    expect(screen.getByTestId("current-lang")).toHaveTextContent("en");
    expect(screen.getByTestId("translated-title")).toBeInTheDocument();
  });

  it("supports initialLanguage prop to set language on mount", async () => {
    await act(async () => {
      render(
        <I18nProvider initialLanguage="es">
          <ConsumerComponent />
        </I18nProvider>
      );
    });

    expect(screen.getByTestId("current-lang")).toHaveTextContent("es");
  });

  it("falls back to default text when translation key is absent", () => {
    render(
      <I18nProvider>
        <ConsumerComponent />
      </I18nProvider>
    );

    expect(screen.getByTestId("fallback-translation")).toHaveTextContent(
      "Default Fallback Text"
    );
  });

  it("exports the singleton i18n instance", () => {
    expect(i18n).toBeDefined();
    expect(i18n.isInitialized).toBe(true);
  });

  it("works with default export", () => {
    render(
      <DefaultI18nProvider>
        <div data-testid="default-child">Rendered via default export</div>
      </DefaultI18nProvider>
    );

    expect(screen.getByTestId("default-child")).toHaveTextContent(
      "Rendered via default export"
    );
  });
});
