import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import AppShell, { AppShell as NamedAppShell } from "@/components/AppShell";
import { SkipToContent } from "@/components/ui/SkipToContent";

jest.mock("@/components/TopNav", () => ({
  TopNav: () => <nav data-testid="mock-top-nav">TopNav Component</nav>,
}));

jest.mock("@/components/CosmosBackground", () => ({
  CosmosBackground: ({ enabled }: { enabled?: boolean }) => (
    <div data-testid="mock-cosmos-background" data-enabled={enabled ? "true" : "false"}>
      CosmosBackground
    </div>
  ),
}));

describe("AppShell Chrome Component", () => {
  afterEach(() => {
    document.getElementById("main-content")?.remove();
  });

  it("exports named AppShell and default AppShell", () => {
    expect(AppShell).toBeDefined();
    expect(NamedAppShell).toBe(AppShell);
  });

  it("renders children inside the application shell content", () => {
    render(
      <AppShell>
        <div data-testid="page-content">Dashboard Content</div>
      </AppShell>
    );

    expect(screen.getByTestId("page-content")).toBeInTheDocument();
    expect(screen.getByText("Dashboard Content")).toBeInTheDocument();
    expect(screen.getByTestId("app-shell-content")).not.toHaveAttribute("id");
  });

  it("renders one accessible skip link before primary navigation", () => {
    const main = document.createElement("main");
    main.id = "main-content";
    main.tabIndex = -1;
    document.body.appendChild(main);

    render(
      <>
        <SkipToContent>Skip to main content</SkipToContent>
        <AppShell>
          <div>Dashboard Content</div>
        </AppShell>
      </>
    );

    const links = screen.getAllByRole("link", {
      name: "Skip to main content",
    });
    expect(links).toHaveLength(1);

    const link = links[0];
    expect(link).toHaveAttribute("href", "#main-content");
    expect(link).toHaveClass(
      "sr-only",
      "focus:not-sr-only",
      "focus:z-50",
      "focus:bg-indigo-600",
      "focus:text-white"
    );

    const nav = screen.getByTestId("mock-top-nav");
    expect(link.compareDocumentPosition(nav) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(
      Boolean(link.compareDocumentPosition(nav) & Node.DOCUMENT_POSITION_FOLLOWING)
    ).toBe(true);
  });

  it("moves focus to the main content target and does not add another main landmark", () => {
    const main = document.createElement("main");
    main.id = "main-content";
    main.tabIndex = -1;
    main.textContent = "Shared root content";
    document.body.appendChild(main);

    render(
      <>
        <SkipToContent>Skip to main content</SkipToContent>
        <AppShell>
          <div>Dashboard Content</div>
        </AppShell>
      </>
    );

    const link = screen.getByRole("link", { name: "Skip to main content" });
    link.focus();
    expect(document.activeElement).toBe(link);
    expect(link).toHaveClass("focus:not-sr-only");

    fireEvent.click(link);

    expect(main).toHaveAttribute("tabindex", "-1");
    expect(document.activeElement).toBe(main);
    expect(document.querySelectorAll("#main-content")).toHaveLength(1);
    expect(document.querySelectorAll("main")).toHaveLength(1);
  });

  it("renders TopNav and CosmosBackground enabled by default", () => {
    render(
      <AppShell>
        <div>Content</div>
      </AppShell>
    );

    expect(screen.getByTestId("mock-top-nav")).toBeInTheDocument();
    const bg = screen.getByTestId("mock-cosmos-background");
    expect(bg).toBeInTheDocument();
    expect(bg).toHaveAttribute("data-enabled", "true");
  });

  it("disables CosmosBackground when showCosmosBackground is false", () => {
    render(
      <AppShell showCosmosBackground={false}>
        <div>Content</div>
      </AppShell>
    );

    const bg = screen.getByTestId("mock-cosmos-background");
    expect(bg).toHaveAttribute("data-enabled", "false");
  });

  it("renders default data-testid='app-shell'", () => {
    render(
      <AppShell>
        <div>Content</div>
      </AppShell>
    );

    expect(screen.getByTestId("app-shell")).toBeInTheDocument();
  });

  it("allows custom data-testid override", () => {
    render(
      <AppShell data-testid="custom-app-shell">
        <div>Content</div>
      </AppShell>
    );

    expect(screen.getByTestId("custom-app-shell")).toBeInTheDocument();
  });

  it("passes axe-core accessibility checks", async () => {
    const axe = await import("axe-core");
    const { container } = render(
      <AppShell>
        <button type="button">Dashboard action</button>
      </AppShell>
    );

    const results = await axe.run(container);
    expect(results.violations).toHaveLength(0);
  });

  it("merges custom className via cn utility", () => {
    render(
      <AppShell className="custom-theme-layout">
        <div>Content</div>
      </AppShell>
    );

    const shell = screen.getByTestId("app-shell");
    expect(shell).toHaveClass("custom-theme-layout", "relative", "min-h-screen");
  });
});
