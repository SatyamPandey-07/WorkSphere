import React from "react";
import { render, screen } from "@testing-library/react";
import { Badge, badgeVariants } from "@/components/ui/Badge";

describe("Badge Component", () => {
  test("renders with default styling and children", () => {
    render(<Badge>Default Badge</Badge>);
    const badge = screen.getByText("Default Badge");

    expect(badge).toBeInTheDocument();
    expect(badge).toHaveClass("bg-zinc-900");
    expect(badge).toHaveClass("text-zinc-50");
  });

  test("renders standard variants correctly", () => {
    const { rerender } = render(<Badge variant="secondary">Secondary</Badge>);
    expect(screen.getByText("Secondary")).toHaveClass("bg-zinc-100");

    rerender(<Badge variant="destructive">Destructive</Badge>);
    expect(screen.getByText("Destructive")).toHaveClass("bg-red-500");

    rerender(<Badge variant="outline">Outline</Badge>);
    expect(screen.getByText("Outline")).toHaveClass("border-zinc-200");
  });

  test("renders variant='neon-cyberpunk' with dual-tone cyan/magenta border and glow shadow", () => {
    render(
      <Badge variant="neon-cyberpunk" data-testid="neon-badge">
        High Activity
      </Badge>,
    );
    const badge = screen.getByTestId("neon-badge");

    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent("High Activity");

    // Shadow token requirement
    expect(badge).toHaveClass("shadow-[0_0_12px_rgba(6,182,212,0.6)]");

    // Dual-tone cyan/magenta border lighting
    expect(badge).toHaveClass("border-cyan-400");
    expect(badge).toHaveClass("border-r-fuchsia-500");
    expect(badge).toHaveClass("border-b-fuchsia-500");

    // Glowing text shadows
    expect(badge).toHaveClass("[text-shadow:0_0_8px_rgba(6,182,212,0.8)]");

    // WCAG AA contrast text against dark background
    expect(badge).toHaveClass("text-cyan-300");
    expect(badge).toHaveClass("bg-zinc-950/90");

    // Dark and Cyberpunk mode compatibility
    expect(badge).toHaveClass("dark:text-cyan-200");
    expect(badge).toHaveClass("cyberpunk:text-cyan-200");
  });

  test("applies custom className alongside variant styles", () => {
    render(
      <Badge variant="neon-cyberpunk" className="custom-class uppercase">
        Custom
      </Badge>,
    );
    const badge = screen.getByText("Custom");

    expect(badge).toHaveClass("custom-class");
    expect(badge).toHaveClass("uppercase");
    expect(badge).toHaveClass("shadow-[0_0_12px_rgba(6,182,212,0.6)]");
  });

  test("badgeVariants helper generates expected classes for neon-cyberpunk", () => {
    const classes = badgeVariants({ variant: "neon-cyberpunk" });

    expect(classes).toContain("shadow-[0_0_12px_rgba(6,182,212,0.6)]");
    expect(classes).toContain("border-cyan-400");
    expect(classes).toContain("border-r-fuchsia-500");
    expect(classes).toContain("[text-shadow:0_0_8px_rgba(6,182,212,0.8)]");
  });
});
