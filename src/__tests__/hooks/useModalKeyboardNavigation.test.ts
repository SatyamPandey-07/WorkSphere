/** @jest-environment jsdom */
import { renderHook } from "@testing-library/react";
import { useModalKeyboardNavigation } from "@/hooks/useModalKeyboardNavigation";

describe("useModalKeyboardNavigation (#10006)", () => {
  let onClose: jest.Mock;
  let onConfirm: jest.Mock;
  let onRotateClockwise: jest.Mock;
  let onRotateCounterClockwise: jest.Mock;
  let onZoomIn: jest.Mock;
  let onZoomOut: jest.Mock;
  let onResetZoom: jest.Mock;

  beforeEach(() => {
    onClose = jest.fn();
    onConfirm = jest.fn();
    onRotateClockwise = jest.fn();
    onRotateCounterClockwise = jest.fn();
    onZoomIn = jest.fn();
    onZoomOut = jest.fn();
    onResetZoom = jest.fn();
  });

  const setup = (isOpen = true) =>
    renderHook(() =>
      useModalKeyboardNavigation({
        isOpen,
        enableFocusTrap: false,
        onClose,
        onConfirm,
        onRotateClockwise,
        onRotateCounterClockwise,
        onZoomIn,
        onZoomOut,
        onResetZoom,
      })
    );

  it("handles Escape key to trigger onClose", () => {
    setup(true);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("handles Enter key to trigger onConfirm", () => {
    setup(true);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("handles Ctrl+Enter or Cmd+Enter to trigger onConfirm", () => {
    setup(true);
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true })
    );
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("handles R and Shift+R keys for clockwise and counter-clockwise rotation", () => {
    setup(true);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "r" }));
    expect(onRotateClockwise).toHaveBeenCalledTimes(1);

    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "R", shiftKey: true })
    );
    expect(onRotateCounterClockwise).toHaveBeenCalledTimes(1);
  });

  it("handles + and - keys for zoom in and zoom out", () => {
    setup(true);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "+" }));
    expect(onZoomIn).toHaveBeenCalledTimes(1);

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "-" }));
    expect(onZoomOut).toHaveBeenCalledTimes(1);

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "0" }));
    expect(onResetZoom).toHaveBeenCalledTimes(1);
  });

  it("does not fire callbacks when isOpen is false", () => {
    setup(false);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "r" }));
    expect(onClose).not.toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onRotateClockwise).not.toHaveBeenCalled();
  });
});
