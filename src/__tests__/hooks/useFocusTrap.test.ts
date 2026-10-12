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

  it("safely ignores nested SVG elements with tabindex='0' lacking valid HTMLElement focus capabilities and continues trapping Tab cycle", () => {
    // Create an SVG element with tabindex="0" that lacks a valid focus method or is not an HTMLElement
    const svgEl = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svgEl.setAttribute("tabindex", "0");
    // Explicitly delete focus or set to non-function to simulate older SVG element prototypes
    (svgEl as any).focus = undefined;

    // Also add a disabled button to ensure it is filtered out
    const disabledBtn = document.createElement("button");
    disabledBtn.setAttribute("disabled", "true");
    disabledBtn.textContent = "Disabled";

    container.insertBefore(svgEl, btn2);
    container.insertBefore(disabledBtn, btn2);

    const containerRef = { current: container };
    const { result } = renderHook(() => useFocusTrap(containerRef, { isActive: true }));

    act(() => {
      jest.runAllTimers();
    });

    const focusable = result.current.getFocusableElements();
    expect(focusable).not.toContain(svgEl);
    expect(focusable).not.toContain(disabledBtn);
    expect(focusable).toEqual([btn1, input1, btn2]);

    // Test cycling forward from btn2 wraps back to btn1
    btn2.focus();
    expect(document.activeElement).toBe(btn2);

    const forwardTab = new KeyboardEvent("keydown", {
      key: "Tab",
      shiftKey: false,
      bubbles: true,
      cancelable: true,
    });
    document.dispatchEvent(forwardTab);
    expect(document.activeElement).toBe(btn1);

    // Test cycling backward from btn1 wraps to btn2
    const backwardTab = new KeyboardEvent("keydown", {
      key: "Tab",
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    document.dispatchEvent(backwardTab);
    expect(document.activeElement).toBe(btn2);
  });
});
