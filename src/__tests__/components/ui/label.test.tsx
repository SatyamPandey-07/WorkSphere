import React, { createRef } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import Label, { Label as NamedLabel } from "@/components/ui/label";

describe("Label Primitive Component", () => {
  it("exports named Label and default Label", () => {
    expect(Label).toBeDefined();
    expect(NamedLabel).toBe(Label);
  });

  it("renders with base styling classes and children", () => {
    render(<Label>Username</Label>);

    const label = screen.getByText("Username");
    expect(label).toBeInTheDocument();
    expect(label.tagName).toBe("LABEL");
    expect(label).toHaveClass("text-sm", "font-medium", "leading-none");
  });

  it("associates with input element via htmlFor attribute", () => {
    render(
      <div>
        <Label htmlFor="email-input">Email Address</Label>
        <input id="email-input" type="email" placeholder="test@example.com" />
      </div>
    );

    const label = screen.getByText("Email Address");
    expect(label).toHaveAttribute("for", "email-input");

    const input = screen.getByLabelText("Email Address");
    expect(input).toBeInTheDocument();
  });

  it("forwards ref to the underlying HTML label element", () => {
    const ref = createRef<HTMLLabelElement>();
    render(<Label ref={ref}>Ref Label</Label>);

    expect(ref.current).toBeInstanceOf(HTMLLabelElement);
    expect(ref.current?.tagName).toBe("LABEL");
  });

  it("merges custom className via cn utility", () => {
    render(<Label className="text-rose-500 font-bold uppercase">Important Label</Label>);

    const label = screen.getByText("Important Label");
    expect(label).toHaveClass("text-rose-500", "font-bold", "uppercase");
  });

  it("dispatches onClick event handler when clicked", () => {
    const handleClick = jest.fn();
    render(<Label onClick={handleClick}>Clickable Label</Label>);

    const label = screen.getByText("Clickable Label");
    fireEvent.click(label);

    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it("supports nesting child elements inside label", () => {
    render(
      <Label>
        <span>Required</span>
        <strong>Password</strong>
      </Label>
    );

    expect(screen.getByText("Required")).toBeInTheDocument();
    expect(screen.getByText("Password")).toBeInTheDocument();
  });
});
