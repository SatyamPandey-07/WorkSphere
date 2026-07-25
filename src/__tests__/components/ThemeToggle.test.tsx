import { render, screen } from "@testing-library/react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { ThemeProvider } from "@/components/ThemeProvider";

describe("ThemeToggle", () => {
  it("renders sun/moon icons with dark-mode CSS toggles (no hydration flash)", () => {
    const { container } = render(
      <ThemeProvider initialTheme="dark">
        <ThemeToggle />
      </ThemeProvider>,
    );

    const svgs = container.querySelectorAll("svg");
    const classes = Array.from(svgs).map(
      (el) => el.getAttribute("class") || "",
    );

    expect(classes.some((c) => c.includes("dark:hidden"))).toBe(true);
    expect(classes.some((c) => c.includes("dark:block"))).toBe(true);

    expect(
      screen.getByRole("switch", { name: /switch to light mode/i }),
    ).toBeInTheDocument();
  });
});
