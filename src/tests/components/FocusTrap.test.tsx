import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import FocusTrap, { FocusTrap as NamedFocusTrap } from "@/components/ui/FocusTrap";

describe("FocusTrap Component", () => {
  // 1. Component renders correctly
  it("renders correctly in the document", () => {
    const { container } = render(
      <FocusTrap>
        <div>Content</div>
      </FocusTrap>
    );
    expect(container.firstChild).toBeInTheDocument();
    expect(FocusTrap).toBeDefined();
    expect(NamedFocusTrap).toBe(FocusTrap);
  });

  // 2. Default data-testid is present
  it("renders with default data-testid when none is provided", () => {
    render(
      <FocusTrap>
        <div>Content</div>
      </FocusTrap>
    );
    const trap = screen.getByTestId("focus-trap");
    expect(trap).toBeInTheDocument();
  });

  // 3. Custom data-testid overrides the default
  it("allows overriding with a custom data-testid", () => {
    render(
      <FocusTrap data-testid="custom-trap-container">
        <div>Content</div>
      </FocusTrap>
    );
    expect(screen.getByTestId("custom-trap-container")).toBeInTheDocument();
    expect(screen.queryByTestId("focus-trap")).not.toBeInTheDocument();
  });

  // 4. Children render correctly
  it("renders children elements properly", () => {
    render(
      <FocusTrap>
        <h1 data-testid="trap-title">Dialog Title</h1>
        <p>Some explanatory text</p>
        <button data-testid="trap-action">Click me</button>
      </FocusTrap>
    );
    expect(screen.getByTestId("trap-title")).toHaveTextContent("Dialog Title");
    expect(screen.getByText("Some explanatory text")).toBeInTheDocument();
    expect(screen.getByTestId("trap-action")).toBeInTheDocument();
  });

  // 5. Custom HTML elements/props are preserved if supported
  it("preserves custom HTML elements (as prop) and HTML attributes", () => {
    render(
      <FocusTrap
        as="section"
        id="modal-section-id"
        title="Custom Section"
        data-custom-attribute="test-value"
      >
        <p>Section Body</p>
      </FocusTrap>
    );
    const element = screen.getByTestId("focus-trap");
    expect(element.tagName).toBe("SECTION");
    expect(element).toHaveAttribute("id", "modal-section-id");
    expect(element).toHaveAttribute("title", "Custom Section");
    expect(element).toHaveAttribute("data-custom-attribute", "test-value");
  });

  // 6. ARIA attributes are correctly applied
  it("applies default and custom ARIA attributes properly", () => {
    const { unmount } = render(
      <FocusTrap>
        <span>Default ARIA</span>
      </FocusTrap>
    );
    const defaultElement = screen.getByTestId("focus-trap");
    expect(defaultElement).toHaveAttribute("role", "dialog");
    expect(defaultElement).toHaveAttribute("aria-modal", "true");
    unmount();

    render(
      <FocusTrap
        role="alertdialog"
        aria-modal={false}
        aria-label="Alert Dialog Title"
        aria-labelledby="alert-title-id"
        aria-describedby="alert-desc-id"
      >
        <h2 id="alert-title-id">Alert</h2>
        <p id="alert-desc-id">Description</p>
      </FocusTrap>
    );
    const customElement = screen.getByTestId("focus-trap");
    expect(customElement).toHaveAttribute("role", "alertdialog");
    expect(customElement).toHaveAttribute("aria-modal", "false");
    expect(customElement).toHaveAttribute("aria-label", "Alert Dialog Title");
    expect(customElement).toHaveAttribute("aria-labelledby", "alert-title-id");
    expect(customElement).toHaveAttribute("aria-describedby", "alert-desc-id");
  });

  // 7. Keyboard interactions work correctly
  it("handles keyboard interactions such as Escape key callback", () => {
    const onEscapeMock = jest.fn();
    const { rerender } = render(
      <FocusTrap onEscape={onEscapeMock} isActive={true}>
        <button>Inside</button>
      </FocusTrap>
    );

    fireEvent.keyDown(document, { key: "Escape", code: "Escape" });
    expect(onEscapeMock).toHaveBeenCalledTimes(1);

    // When inactive, Escape should not trigger callback
    rerender(
      <FocusTrap onEscape={onEscapeMock} isActive={false}>
        <button>Inside</button>
      </FocusTrap>
    );

    fireEvent.keyDown(document, { key: "Escape", code: "Escape" });
    expect(onEscapeMock).toHaveBeenCalledTimes(1);
  });

  // 8. Focus is trapped within the component where applicable
  it("traps focus within the component on Tab and Shift+Tab navigation", async () => {
    render(
      <FocusTrap>
        <button data-testid="first-button">First</button>
        <input data-testid="middle-input" placeholder="Middle" />
        <button data-testid="last-button">Last</button>
      </FocusTrap>
    );

    const firstBtn = screen.getByTestId("first-button");
    const lastBtn = screen.getByTestId("last-button");

    // Wait for initial focus settlement
    await waitFor(() => {
      expect(document.activeElement).toBe(firstBtn);
    });

    // Tab from last element wraps to first
    lastBtn.focus();
    expect(document.activeElement).toBe(lastBtn);
    fireEvent.keyDown(document, { key: "Tab", code: "Tab", shiftKey: false });
    expect(document.activeElement).toBe(firstBtn);

    // Shift+Tab from first element wraps to last
    firstBtn.focus();
    expect(document.activeElement).toBe(firstBtn);
    fireEvent.keyDown(document, { key: "Tab", code: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(lastBtn);
  });

  it("focuses specific initial element when initialFocusSelector is specified", async () => {
    render(
      <FocusTrap initialFocusSelector="[data-testid='second-button']">
        <button data-testid="first-button">First</button>
        <button data-testid="second-button">Second</button>
      </FocusTrap>
    );

    const secondBtn = screen.getByTestId("second-button");
    await waitFor(() => {
      expect(document.activeElement).toBe(secondBtn);
    });
  });

  // 9. Existing focus restoration behavior is preserved, if supported
  it("preserves focus restoration to trigger element upon unmount when returnFocus is enabled", () => {
    const trigger = document.createElement("button");
    trigger.setAttribute("data-testid", "trigger-button");
    document.body.appendChild(trigger);
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    const { unmount } = render(
      <FocusTrap returnFocus={true}>
        <button data-testid="trap-btn">Trap Content</button>
      </FocusTrap>
    );

    unmount();
    expect(document.activeElement).toBe(trigger);
    document.body.removeChild(trigger);
  });

  it("does not restore focus when returnFocus is disabled", () => {
    const trigger = document.createElement("button");
    trigger.setAttribute("data-testid", "trigger-button-no-return");
    document.body.appendChild(trigger);
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    const { unmount } = render(
      <FocusTrap returnFocus={false}>
        <button data-testid="trap-btn-no-return">Trap Content</button>
      </FocusTrap>
    );

    const trapBtn = screen.getByTestId("trap-btn-no-return");
    trapBtn.focus();

    unmount();
    expect(document.activeElement).not.toBe(trigger);
    document.body.removeChild(trigger);
  });
});

