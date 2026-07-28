import { render, screen } from "@testing-library/react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { ThemeProvider } from "@/components/ThemeProvider";

describe("ThemeToggle", () => {
  afterEach(() => {
    document.documentElement.classList.remove("dark", "cyberpunk");
    window.localStorage.clear();
  });

  it("renders the sun icon and correct label when theme is light", () => {
    render(
      <ThemeProvider initialTheme="light">
        <ThemeToggle />
      </ThemeProvider>,
    );
    expect(
      screen.getByRole("switch", { name: /switch to dark mode/i }),
    ).toBeInTheDocument();
  });

  it("renders the moon icon and correct label when theme is dark", () => {
    render(
      <ThemeProvider initialTheme="dark">
        <ThemeToggle />
      </ThemeProvider>,
    );
    expect(
      screen.getByRole("switch", { name: /switch to cyberpunk mode/i }),
    ).toBeInTheDocument();
  });

  it("renders the cyberpunk icon and correct label when theme is cyberpunk", () => {
    render(
      <ThemeProvider initialTheme="cyberpunk">
        <ThemeToggle />
      </ThemeProvider>,
    );
    expect(
      screen.getByRole("switch", { name: /switch to light mode/i }),
    ).toBeInTheDocument();
  });

  it("reflects the active theme via aria-checked and data-active-theme", () => {
    const { unmount } = render(
      <ThemeProvider initialTheme="light">
        <ThemeToggle />
      </ThemeProvider>,
    );
    let btn = screen.getByRole("switch");
    expect(btn).toHaveAttribute("aria-checked", "false");
    expect(btn).toHaveAttribute("data-active-theme", "light");

    unmount();
    document.documentElement.classList.remove("dark", "cyberpunk");

    render(
      <ThemeProvider initialTheme="cyberpunk">
        <ThemeToggle />
      </ThemeProvider>,
    );
    btn = screen.getByRole("switch");
    expect(btn).toHaveAttribute("aria-checked", "true");
    expect(btn).toHaveAttribute("data-active-theme", "cyberpunk");
  });

  it("toggles theme on Cmd/Ctrl + Shift + L keyboard shortcut", () => {
    render(
      <ThemeProvider initialTheme="light">
        <ThemeToggle />
      </ThemeProvider>,
    );
    const btn = screen.getByRole("switch");
    expect(btn).toHaveAttribute("data-active-theme", "light");

    // Simulate Ctrl + Shift + L
    const event = new KeyboardEvent("keydown", {
      key: "L",
      ctrlKey: true,
      shiftKey: true,
      bubbles: true,
    });
    window.dispatchEvent(event);

    expect(btn).toHaveAttribute("data-active-theme", "dark");
  });
});
