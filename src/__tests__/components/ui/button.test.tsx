import React, { createRef } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import Button, { Button as NamedButton } from "@/components/ui/button";

describe("Button Primitive Component", () => {
  it("exports named Button and default Button", () => {
    expect(Button).toBeDefined();
    expect(NamedButton).toBe(Button);
  });

  it("renders with default variant, default size, and default type='button'", () => {
    render(<Button>Click me</Button>);

    const btn = screen.getByRole("button", { name: /click me/i });
    expect(btn).toBeInTheDocument();
    expect(btn).toHaveAttribute("type", "button");
    expect(btn).toHaveClass("bg-zinc-900", "h-10", "px-4", "py-2");
  });

  it("allows custom type attribute override like submit or reset", () => {
    render(<Button type="submit">Submit Form</Button>);

    const btn = screen.getByRole("button", { name: /submit form/i });
    expect(btn).toHaveAttribute("type", "submit");
  });

  it("renders all supported variants correctly", () => {
    const { rerender } = render(<Button variant="destructive">Delete</Button>);
    let btn = screen.getByRole("button", { name: /delete/i });
    expect(btn).toHaveClass("bg-red-500");

    rerender(<Button variant="outline">Outline</Button>);
    btn = screen.getByRole("button", { name: /outline/i });
    expect(btn).toHaveClass("border", "border-zinc-200");

    rerender(<Button variant="secondary">Secondary</Button>);
    btn = screen.getByRole("button", { name: /secondary/i });
    expect(btn).toHaveClass("bg-zinc-100");

    rerender(<Button variant="ghost">Ghost</Button>);
    btn = screen.getByRole("button", { name: /ghost/i });
    expect(btn).toHaveClass("hover:bg-zinc-100");

    rerender(<Button variant="link">Link</Button>);
    btn = screen.getByRole("button", { name: /link/i });
    expect(btn).toHaveClass("underline-offset-4");
  });

  it("renders all supported sizes correctly", () => {
    const { rerender } = render(<Button size="sm">Small</Button>);
    let btn = screen.getByRole("button", { name: /small/i });
    expect(btn).toHaveClass("h-9", "px-3");

    rerender(<Button size="lg">Large</Button>);
    btn = screen.getByRole("button", { name: /large/i });
    expect(btn).toHaveClass("h-11", "px-8");

    rerender(<Button size="icon" aria-label="Icon Button">★</Button>);
    btn = screen.getByRole("button", { name: /icon button/i });
    expect(btn).toHaveClass("h-10", "w-10");
  });

  it("forwards ref to the underlying HTML button element", () => {
    const ref = createRef<HTMLButtonElement>();
    render(<Button ref={ref}>Ref Button</Button>);

    expect(ref.current).toBeInstanceOf(HTMLButtonElement);
    expect(ref.current?.tagName).toBe("BUTTON");
  });

  it("dispatches onClick event handler when clicked", () => {
    const handleClick = jest.fn();
    render(<Button onClick={handleClick}>Action</Button>);

    const btn = screen.getByRole("button", { name: /action/i });
    fireEvent.click(btn);
    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it("disables button when disabled prop is provided", () => {
    const handleClick = jest.fn();
    render(<Button disabled onClick={handleClick}>Disabled Action</Button>);

    const btn = screen.getByRole("button", { name: /disabled action/i });
    expect(btn).toBeDisabled();
    expect(btn).toHaveClass("disabled:opacity-50", "disabled:pointer-events-none");

    fireEvent.click(btn);
    expect(handleClick).not.toHaveBeenCalled();
  });

  it("merges custom className via cn utility", () => {
    render(<Button className="shadow-2xl hover:scale-105">Styled</Button>);

    const btn = screen.getByRole("button", { name: /styled/i });
    expect(btn).toHaveClass("shadow-2xl", "hover:scale-105");
  });
});
