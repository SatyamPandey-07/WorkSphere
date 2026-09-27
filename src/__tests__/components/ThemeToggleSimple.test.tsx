import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeToggle } from "@/components/ThemeToggle";
import { ThemeProvider } from "@/components/ThemeProvider";

// Stub the View Transitions API — jsdom does not implement it
const startViewTransitionMock = jest.fn((callback: () => void) => {
  callback();
  return { finished: Promise.resolve(), ready: Promise.resolve(), updateCallbackDone: Promise.resolve() };
});

beforeEach(() => {
  Object.defineProperty(document, "startViewTransition", {
    value: startViewTransitionMock,
    writable: true,
    configurable: true,
  });
  startViewTransitionMock.mockClear();
  document.documentElement.classList.remove("dark", "cyberpunk");
  window.localStorage.clear();
});

afterEach(() => {
  document.documentElement.classList.remove("dark", "cyberpunk");
});

describe("ThemeToggle — click behavior", () => {
  it("renders a toggle button", () => {
    render(
      <ThemeProvider initialTheme="light">
        <ThemeToggle />
      </ThemeProvider>,
    );
    expect(screen.getByRole("switch")).toBeInTheDocument();
  });

  it("starts with aria-checked=false when theme is light", () => {
    render(
      <ThemeProvider initialTheme="light">
        <ThemeToggle />
      </ThemeProvider>,
    );
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "false");
  });

  it("cycles light → dark on first click", () => {
    render(
      <ThemeProvider initialTheme="light">
        <ThemeToggle />
      </ThemeProvider>,
    );
    const btn = screen.getByRole("switch");
    fireEvent.click(btn);
    expect(btn).toHaveAttribute("data-active-theme", "dark");
  });

  it("cycles dark → cyberpunk on click", () => {
    render(
      <ThemeProvider initialTheme="dark">
        <ThemeToggle />
      </ThemeProvider>,
    );
    const btn = screen.getByRole("switch");
    fireEvent.click(btn);
    expect(btn).toHaveAttribute("data-active-theme", "cyberpunk");
  });

  it("cycles cyberpunk → light on click", () => {
    render(
      <ThemeProvider initialTheme="cyberpunk">
        <ThemeToggle />
      </ThemeProvider>,
    );
    const btn = screen.getByRole("switch");
    fireEvent.click(btn);
    expect(btn).toHaveAttribute("data-active-theme", "light");
  });

  it("uses document.startViewTransition when available", () => {
    render(
      <ThemeProvider initialTheme="light">
        <ThemeToggle />
      </ThemeProvider>,
    );
    fireEvent.click(screen.getByRole("switch"));
    expect(startViewTransitionMock).toHaveBeenCalledTimes(1);
  });

  it("falls back to direct toggle when startViewTransition is not available", () => {
    // Simulate a browser without View Transitions support
    Object.defineProperty(document, "startViewTransition", {
      value: undefined,
      writable: true,
      configurable: true,
    });

    render(
      <ThemeProvider initialTheme="light">
        <ThemeToggle />
      </ThemeProvider>,
    );
    const btn = screen.getByRole("switch");
    fireEvent.click(btn);
    expect(btn).toHaveAttribute("data-active-theme", "dark");
  });

  it("persists theme choice to localStorage on click", () => {
    render(
      <ThemeProvider initialTheme="light">
        <ThemeToggle />
      </ThemeProvider>,
    );
    fireEvent.click(screen.getByRole("switch"));
    expect(window.localStorage.getItem("worksphere-theme")).toBe("dark");
  });

  it("has correct aria-label describing the next theme", () => {
    render(
      <ThemeProvider initialTheme="light">
        <ThemeToggle />
      </ThemeProvider>,
    );
    const btn = screen.getByRole("switch");
    expect(btn.getAttribute("aria-label")).toMatch(/switch to dark mode/i);
  });
});

describe("ThemeToggle — button hover styles", () => {
  it("has cursor-pointer class on the button", () => {
    render(
      <ThemeProvider initialTheme="light">
        <ThemeToggle />
      </ThemeProvider>,
    );
    expect(screen.getByRole("switch")).toHaveClass("cursor-pointer");
  });

  it("has rounded-xl class for pill shape", () => {
    render(
      <ThemeProvider initialTheme="light">
        <ThemeToggle />
      </ThemeProvider>,
    );
    expect(screen.getByRole("switch")).toHaveClass("rounded-xl");
  });

  it("has hover:text-white class for hover text color change", async () => {
    render(
      <ThemeProvider initialTheme="light">
        <ThemeToggle />
      </ThemeProvider>,
    );
    expect(screen.getByRole("switch")).toHaveClass("hover:text-white");
  });

  it("has active:scale-95 class for press feedback", () => {
    render(
      <ThemeProvider initialTheme="light">
        <ThemeToggle />
      </ThemeProvider>,
    );
    expect(screen.getByRole("switch")).toHaveClass("active:scale-95");
  });
});
