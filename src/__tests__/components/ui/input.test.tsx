import React, { createRef } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import Input, { Input as NamedInput } from "@/components/ui/input";

describe("Input Primitive Component", () => {
  it("exports named Input and default Input", () => {
    expect(Input).toBeDefined();
    expect(NamedInput).toBe(Input);
  });

  it("renders with default type='text' and base styling classes", () => {
    render(<Input placeholder="Enter username" />);

    const input = screen.getByPlaceholderText("Enter username");
    expect(input).toBeInTheDocument();
    expect(input).toHaveAttribute("type", "text");
    expect(input).toHaveClass("flex", "h-10", "w-full", "rounded-md", "border");
  });

  it("supports custom input types like email, password, and number", () => {
    const { rerender } = render(<Input type="email" placeholder="Email" />);
    let input = screen.getByPlaceholderText("Email");
    expect(input).toHaveAttribute("type", "email");

    rerender(<Input type="password" placeholder="Password" />);
    input = screen.getByPlaceholderText("Password");
    expect(input).toHaveAttribute("type", "password");

    rerender(<Input type="number" placeholder="Quantity" />);
    input = screen.getByPlaceholderText("Quantity");
    expect(input).toHaveAttribute("type", "number");
  });

  it("handles user typing and triggers onChange callback", () => {
    const handleChange = jest.fn();
    render(<Input placeholder="Type here" onChange={handleChange} />);

    const input = screen.getByPlaceholderText("Type here");
    fireEvent.change(input, { target: { value: "Hello WorkSphere" } });

    expect(handleChange).toHaveBeenCalledTimes(1);
    expect((input as HTMLInputElement).value).toBe("Hello WorkSphere");
  });

  it("forwards ref to the underlying HTML input element", () => {
    const ref = createRef<HTMLInputElement>();
    render(<Input ref={ref} placeholder="With ref" />);

    expect(ref.current).toBeInstanceOf(HTMLInputElement);
    expect(ref.current?.tagName).toBe("INPUT");
  });

  it("applies disabled styles and prevents interaction when disabled", () => {
    const handleChange = jest.fn();
    render(<Input disabled placeholder="Disabled input" onChange={handleChange} />);

    const input = screen.getByPlaceholderText("Disabled input");
    expect(input).toBeDisabled();
    expect(input).toHaveClass("disabled:cursor-not-allowed", "disabled:opacity-50");
  });

  it("merges custom className via cn utility", () => {
    render(<Input className="border-red-500 shadow-md" placeholder="Styled" />);

    const input = screen.getByPlaceholderText("Styled");
    expect(input).toHaveClass("border-red-500", "shadow-md");
  });

  it("passes through accessibility attributes", () => {
    render(
      <Input
        aria-label="Search venues"
        aria-invalid="true"
        aria-describedby="search-error"
        placeholder="Search"
      />
    );

    const input = screen.getByPlaceholderText("Search");
    expect(input).toHaveAttribute("aria-label", "Search venues");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAttribute("aria-describedby", "search-error");
  });
});
