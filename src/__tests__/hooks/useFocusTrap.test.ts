import { renderHook, act } from "@testing-library/react";
import { useFocusTrap } from "@/hooks/useFocusTrap";

describe("useFocusTrap hook", () => {
  let container: HTMLDivElement;
  let btn1: HTMLButtonElement;
  let input1: HTMLInputElement;
  let btn2: HTMLButtonElement;
  let triggerBtn: HTMLButtonElement;

  beforeEach(() => {
    jest.useFakeTimers();

    triggerBtn = document.createElement("button");
    triggerBtn.textContent = "Open Modal";
    document.body.appendChild(triggerBtn);
    triggerBtn.focus();

    container = document.createElement("div");
    btn1 = document.createElement("button");
    btn1.textContent = "First";
    input1 = document.createElement("input");
    btn2 = document.createElement("button");
    btn2.textContent = "Last";

    container.appendChild(btn1);
    container.appendChild(input1);
    container.appendChild(btn2);
    document.body.appendChild(container);
  });

  afterEach(() => {
    jest.useRealTimers();
    document.body.innerHTML = "";
    jest.restoreAllMocks();
  });

  it("focuses the first focusable element upon activation", () => {
    const containerRef = { current: container };
    renderHook(() => useFocusTrap(containerRef, { isActive: true }));

    act(() => {
      jest.runAllTimers();
    });

    expect(document.activeElement).toBe(btn1);
  });

  it("cycles focus from last element to first element on Tab", () => {
    const containerRef = { current: container };
    renderHook(() => useFocusTrap(containerRef, { isActive: true }));

    act(() => {
      jest.runAllTimers();
    });

    btn2.focus();
    expect(document.activeElement).toBe(btn2);

    const event = new KeyboardEvent("keydown", {
      key: "Tab",
      shiftKey: false,
      bubbles: true,
      cancelable: true,
    });

    document.dispatchEvent(event);

    expect(document.activeElement).toBe(btn1);
  });

  it("cycles focus from first element to last element on Shift + Tab", () => {
    const containerRef = { current: container };
    renderHook(() => useFocusTrap(containerRef, { isActive: true }));

    act(() => {
      jest.runAllTimers();
    });

    btn1.focus();
    expect(document.activeElement).toBe(btn1);

    const event = new KeyboardEvent("keydown", {
      key: "Tab",
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });

    document.dispatchEvent(event);

    expect(document.activeElement).toBe(btn2);
  });

  it("calls onEscape when Escape key is pressed", () => {
    const onEscape = jest.fn();
    const containerRef = { current: container };
    renderHook(() =>
      useFocusTrap(containerRef, { isActive: true, onEscape }),
    );

    const event = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });

    document.dispatchEvent(event);

    expect(onEscape).toHaveBeenCalledTimes(1);
  });

  it("restores focus to previous active element on unmount", () => {
    const containerRef = { current: container };
    const { unmount } = renderHook(() =>
      useFocusTrap(containerRef, { isActive: true, returnFocus: true }),
    );

    act(() => {
      jest.runAllTimers();
    });

    unmount();

    expect(document.activeElement).toBe(triggerBtn);
  });
});
