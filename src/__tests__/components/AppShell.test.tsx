import React from "react";
import { render, screen } from "@testing-library/react";
import AppShell, { AppShell as NamedAppShell } from "@/components/AppShell";

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
  it("exports named AppShell and default AppShell", () => {
    expect(AppShell).toBeDefined();
    expect(NamedAppShell).toBe(AppShell);
  });

  it("renders children inside the main content landmark", () => {
    render(
      <AppShell>
        <div data-testid="page-content">Dashboard Content</div>
      </AppShell>
    );

    const main = screen.getByRole("main");
    expect(main).toBeInTheDocument();
    expect(main).toHaveAttribute("id", "main-content");
    expect(screen.getByTestId("page-content")).toBeInTheDocument();
    expect(screen.getByText("Dashboard Content")).toBeInTheDocument();
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
