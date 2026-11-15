import React, { useContext, useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { FrozenRouter } from "@/components/FrozenRouter";
import DefaultFrozenRouter from "@/components/FrozenRouter";
import { LayoutRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";

function ContextDisplay() {
  const ctx = useContext(LayoutRouterContext as any);
  return <div data-testid="route-name">{(ctx as any)?.routeName ?? "none"}</div>;
}

function ParentRouter({
  initialRoute = "page-a",
  frozenEnabled = true,
}: {
  initialRoute?: string;
  frozenEnabled?: boolean;
}) {
  const [route, setRoute] = useState(initialRoute);

  return (
    <LayoutRouterContext.Provider value={{ routeName: route } as any}>
      <button data-testid="change-route" onClick={() => setRoute("page-b")}>
        Change
      </button>
      <FrozenRouter enabled={frozenEnabled}>
        <ContextDisplay />
      </FrozenRouter>
    </LayoutRouterContext.Provider>
  );
}

describe("FrozenRouter Component (#6933)", () => {
  it("renders children without throwing", () => {
    render(
      <FrozenRouter>
        <span data-testid="child-element">Hello World</span>
      </FrozenRouter>
    );

    expect(screen.getByTestId("child-element")).toHaveTextContent("Hello World");
  });

  it("freezes the initial router context when parent context changes", () => {
    render(<ParentRouter initialRoute="initial-page" frozenEnabled={true} />);

    expect(screen.getByTestId("route-name")).toHaveTextContent("initial-page");

    // Change parent route
    fireEvent.click(screen.getByTestId("change-route"));

    // Context inside FrozenRouter remains frozen to "initial-page"
    expect(screen.getByTestId("route-name")).toHaveTextContent("initial-page");
  });

  it("passes live context through when enabled is false", () => {
    render(<ParentRouter initialRoute="initial-page" frozenEnabled={false} />);

    expect(screen.getByTestId("route-name")).toHaveTextContent("initial-page");

    // Change parent route
    fireEvent.click(screen.getByTestId("change-route"));

    // Context inside FrozenRouter updates to "page-b" because freezing is disabled
    expect(screen.getByTestId("route-name")).toHaveTextContent("page-b");
  });

  it("works with default export", () => {
    render(
      <DefaultFrozenRouter>
        <div data-testid="default-export-child">Default Export Works</div>
      </DefaultFrozenRouter>
    );

    expect(screen.getByTestId("default-export-child")).toBeInTheDocument();
  });
});
