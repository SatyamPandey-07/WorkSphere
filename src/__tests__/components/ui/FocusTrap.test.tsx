import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import FocusTrap, { FocusTrap as NamedFocusTrap } from "@/components/ui/FocusTrap";

describe("FocusTrap Component", () => {
  it("exports named FocusTrap and default FocusTrap", () => {
    expect(FocusTrap).toBeDefined();
    expect(NamedFocusTrap).toBe(FocusTrap);
  });

  it("renders children with default role, aria-modal, and data-testid", () => {
    render(
      <FocusTrap>
        <button>Inside Button</button>
      </FocusTrap>
    );

    const trap = screen.getByTestId("focus-trap");
    expect(trap).toBeInTheDocument();
    expect(trap.tagName).toBe("DIV");
    expect(trap).toHaveAttribute("role", "dialog");
    expect(trap).toHaveAttribute("aria-modal", "true");
    expect(screen.getByText("Inside Button")).toBeInTheDocument();
  });

  it("renders with custom polymorphic tag via as prop", () => {
    render(
      <FocusTrap as="section" data-testid="custom-section-trap">
        <p>Section Content</p>
      </FocusTrap>
    );

    const trap = screen.getByTestId("custom-section-trap");
    expect(trap).toBeInTheDocument();
    expect(trap.tagName).toBe("SECTION");
    expect(screen.getByText("Section Content")).toBeInTheDocument();
  });

  it("applies custom ARIA attributes and role", () => {
    render(
      <FocusTrap
        role="alertdialog"
        aria-modal={false}
        aria-label="Confirmation Alert"
        aria-labelledby="alert-heading"
        aria-describedby="alert-desc"
      >
        <h2 id="alert-heading">Notice</h2>
        <p id="alert-desc">Are you sure?</p>
      </FocusTrap>
    );

    const trap = screen.getByTestId("focus-trap");
    expect(trap).toHaveAttribute("role", "alertdialog");
    expect(trap).toHaveAttribute("aria-modal", "false");
    expect(trap).toHaveAttribute("aria-label", "Confirmation Alert");
    expect(trap).toHaveAttribute("aria-labelledby", "alert-heading");
    expect(trap).toHaveAttribute("aria-describedby", "alert-desc");
  });

  it("merges custom className with cn utility", () => {
    render(
      <FocusTrap className="bg-slate-900 border-rose-500">
        <span>Content</span>
      </FocusTrap>
    );

    const trap = screen.getByTestId("focus-trap");
    expect(trap).toHaveClass("bg-slate-900", "border-rose-500");
  });

  it("calls onEscape when Escape key is pressed", () => {
    const handleEscape = jest.fn();
    render(
      <FocusTrap onEscape={handleEscape}>
        <button>Button 1</button>
      </FocusTrap>
    );

    fireEvent.keyDown(document, { key: "Escape", code: "Escape" });
    expect(handleEscape).toHaveBeenCalledTimes(1);
  });

  it("traps focus between first and last focusable elements on Tab and Shift+Tab", async () => {
    render(
      <FocusTrap>
        <button data-testid="btn-first">First</button>
        <input data-testid="input-middle" placeholder="Type here" />
        <button data-testid="btn-last">Last</button>
      </FocusTrap>
    );

    const firstBtn = screen.getByTestId("btn-first");
    const lastBtn = screen.getByTestId("btn-last");

    // After settlement timer, first focusable element should receive focus
    await waitFor(() => {
      expect(document.activeElement).toBe(firstBtn);
    });

    // When on the last element and pressing Tab, wraps to first element
    lastBtn.focus();
    expect(document.activeElement).toBe(lastBtn);
    fireEvent.keyDown(document, { key: "Tab", code: "Tab", shiftKey: false });
    expect(document.activeElement).toBe(firstBtn);

    // When on the first element and pressing Shift+Tab, wraps to last element
    firstBtn.focus();
    expect(document.activeElement).toBe(firstBtn);
    fireEvent.keyDown(document, { key: "Tab", code: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(lastBtn);
  });

  it("focuses element specified by initialFocusSelector", async () => {
    render(
      <FocusTrap initialFocusSelector="[data-testid='btn-second']">
        <button data-testid="btn-first">First</button>
        <button data-testid="btn-second">Second</button>
      </FocusTrap>
    );

    const secondBtn = screen.getByTestId("btn-second");
    await waitFor(() => {
      expect(document.activeElement).toBe(secondBtn);
    });
  });

  it("does not trap focus or intercept escape when isActive is false", () => {
    const handleEscape = jest.fn();
    render(
      <FocusTrap isActive={false} onEscape={handleEscape}>
        <button data-testid="btn-inactive">Inactive Button</button>
      </FocusTrap>
    );

    fireEvent.keyDown(document, { key: "Escape", code: "Escape" });
    expect(handleEscape).not.toHaveBeenCalled();
  });
});
