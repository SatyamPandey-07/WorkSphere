import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { DeskOverlay, DeskOverlayProps } from "@/components/ar/DeskOverlay";
import DefaultDeskOverlay from "@/components/ar/DeskOverlay";

describe("DeskOverlay Component Suite", () => {
  it("renders modal dialog with accessible attributes and content", () => {
    render(<DeskOverlay deskNumber="104A" />);

    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAttribute("aria-labelledby", "desk-overlay-title");
    expect(dialog).toHaveAttribute("aria-describedby", "desk-overlay-desc");

    expect(screen.getByTestId("desk-overlay-title")).toHaveTextContent("Desk Found!");
    expect(screen.getByTestId("desk-overlay-number")).toHaveTextContent("Desk 104A");
    expect(screen.getByTestId("desk-overlay-desc")).toHaveTextContent(
      "Welcome! This desk is reserved for you.",
    );
  });

  it("falls back to 'Desk Assigned' when deskNumber is empty or whitespace", () => {
    const { rerender } = render(<DeskOverlay deskNumber="" />);
    expect(screen.getByTestId("desk-overlay-number")).toHaveTextContent(
      "Desk Assigned",
    );

    rerender(<DeskOverlay deskNumber="   " />);
    expect(screen.getByTestId("desk-overlay-number")).toHaveTextContent(
      "Desk Assigned",
    );

    rerender(<DeskOverlay deskNumber={null as any} />);
    expect(screen.getByTestId("desk-overlay-number")).toHaveTextContent(
      "Desk Assigned",
    );
  });

  it("invokes onDone when 'Done' button is clicked", () => {
    const onDone = jest.fn();
    render(<DeskOverlay deskNumber="5" onDone={onDone} />);

    const doneBtn = screen.getByTestId("desk-overlay-done-btn");
    expect(doneBtn).toHaveAttribute("type", "button");
    expect(doneBtn).toHaveAttribute(
      "aria-label",
      "Confirm desk found and finish navigation",
    );

    fireEvent.click(doneBtn);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("invokes onDone when backdrop is clicked", () => {
    const onDone = jest.fn();
    render(<DeskOverlay deskNumber="5" onDone={onDone} />);

    const backdrop = screen.getByTestId("desk-overlay-backdrop");
    fireEvent.click(backdrop);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("does not invoke onDone when clicking inside modal content (stops propagation)", () => {
    const onDone = jest.fn();
    render(<DeskOverlay deskNumber="5" onDone={onDone} />);

    const modal = screen.getByTestId("desk-overlay-modal");
    fireEvent.click(modal);
    expect(onDone).not.toHaveBeenCalled();
  });

  it("invokes onDone on Escape key press", () => {
    const onDone = jest.fn();
    render(<DeskOverlay deskNumber="5" onDone={onDone} />);

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onDone).toHaveBeenCalledTimes(1);

    // Other keys do nothing
    fireEvent.keyDown(window, { key: "Enter" });
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("removes event listener on unmount", () => {
    const onDone = jest.fn();
    const { unmount } = render(<DeskOverlay deskNumber="5" onDone={onDone} />);

    unmount();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onDone).not.toHaveBeenCalled();
  });

  it("renders with dark mode styling classes and custom className", () => {
    render(<DeskOverlay deskNumber="7" className="custom-test-overlay" />);

    const backdrop = screen.getByTestId("desk-overlay-backdrop");
    expect(backdrop).toHaveClass("custom-test-overlay");

    const modal = screen.getByTestId("desk-overlay-modal");
    expect(modal).toHaveClass("dark:bg-zinc-900");
  });

  it("supports default export rendering identically", () => {
    const onDone = jest.fn();
    render(<DefaultDeskOverlay deskNumber="88" onDone={onDone} />);

    expect(screen.getByTestId("desk-overlay-number")).toHaveTextContent("Desk 88");
    fireEvent.click(screen.getByTestId("desk-overlay-done-btn"));
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});
