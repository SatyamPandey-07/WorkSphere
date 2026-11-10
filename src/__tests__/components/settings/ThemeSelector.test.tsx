import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import {
  ThemeSelector,
  CRT_PHOSPHOR_STORAGE_KEY,
  HUD_CURSOR_STORAGE_KEY,
  getStoredCrtPhosphor,
  setStoredCrtPhosphor,
  getStoredHudCursor,
  setStoredHudCursor,
  applyCrtPhosphorDOM,
  applyHudCursorDOM,
} from "@/components/settings/ThemeSelector";

describe("ThemeSelector utility functions", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.className = "";
    document.documentElement.removeAttribute("data-crt-phosphor");
    document.documentElement.removeAttribute("data-hud-cursor");
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("reads and sets CRT phosphor preference and updates DOM", () => {
    expect(getStoredCrtPhosphor()).toBe(false);

    setStoredCrtPhosphor(true);
    expect(getStoredCrtPhosphor()).toBe(true);
    expect(document.documentElement.classList.contains("crt-phosphor-overlay")).toBe(true);
    expect(document.documentElement.getAttribute("data-crt-phosphor")).toBe("true");

    setStoredCrtPhosphor(false);
    expect(getStoredCrtPhosphor()).toBe(false);
    expect(document.documentElement.classList.contains("crt-phosphor-overlay")).toBe(false);
    expect(document.documentElement.getAttribute("data-crt-phosphor")).toBeNull();
  });

  it("reads and sets HUD cursor preference and updates DOM", () => {
    expect(getStoredHudCursor()).toBe(false);

    setStoredHudCursor(true);
    expect(getStoredHudCursor()).toBe(true);
    expect(document.documentElement.classList.contains("hud-boresight-cursor")).toBe(true);
    expect(document.documentElement.getAttribute("data-hud-cursor")).toBe("true");

    setStoredHudCursor(false);
    expect(getStoredHudCursor()).toBe(false);
    expect(document.documentElement.classList.contains("hud-boresight-cursor")).toBe(false);
    expect(document.documentElement.getAttribute("data-hud-cursor")).toBeNull();
  });
});

describe("ThemeSelector Component", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.className = "";
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("renders with default disabled switches and labels", () => {
    render(<ThemeSelector />);

    expect(screen.getByTestId("theme-selector-container")).toBeInTheDocument();
    expect(screen.getByText("Cockpit CRT Phosphor Overlay")).toBeInTheDocument();
    expect(screen.getByText("Tactical HUD Boresight Cursor")).toBeInTheDocument();

    const crtBtn = screen.getByTestId("cockpit-crt-toggle");
    const cursorBtn = screen.getByTestId("tactical-hud-cursor-toggle");

    expect(crtBtn).toHaveAttribute("aria-checked", "false");
    expect(cursorBtn).toHaveAttribute("aria-checked", "false");
  });

  it("initializes switches based on stored preferences", () => {
    localStorage.setItem(CRT_PHOSPHOR_STORAGE_KEY, "true");
    localStorage.setItem(HUD_CURSOR_STORAGE_KEY, "true");

    render(<ThemeSelector />);

    const crtBtn = screen.getByTestId("cockpit-crt-toggle");
    const cursorBtn = screen.getByTestId("tactical-hud-cursor-toggle");

    expect(crtBtn).toHaveAttribute("aria-checked", "true");
    expect(cursorBtn).toHaveAttribute("aria-checked", "true");
  });

  it("toggles CRT phosphor switch, updates storage, and calls onCrtChange", () => {
    const onCrtChange = jest.fn();
    render(<ThemeSelector onCrtChange={onCrtChange} />);

    const crtBtn = screen.getByTestId("cockpit-crt-toggle");
    fireEvent.click(crtBtn);

    expect(crtBtn).toHaveAttribute("aria-checked", "true");
    expect(localStorage.getItem(CRT_PHOSPHOR_STORAGE_KEY)).toBe("true");
    expect(onCrtChange).toHaveBeenCalledWith(true);

    fireEvent.click(crtBtn);
    expect(crtBtn).toHaveAttribute("aria-checked", "false");
    expect(localStorage.getItem(CRT_PHOSPHOR_STORAGE_KEY)).toBe("false");
    expect(onCrtChange).toHaveBeenCalledWith(false);
  });

  it("toggles Tactical HUD cursor switch, updates storage, and calls onCursorChange", () => {
    const onCursorChange = jest.fn();
    render(<ThemeSelector onCursorChange={onCursorChange} />);

    const cursorBtn = screen.getByTestId("tactical-hud-cursor-toggle");
    fireEvent.click(cursorBtn);

    expect(cursorBtn).toHaveAttribute("aria-checked", "true");
    expect(localStorage.getItem(HUD_CURSOR_STORAGE_KEY)).toBe("true");
    expect(onCursorChange).toHaveBeenCalledWith(true);
  });

  it("synchronizes on cross-tab storage events", () => {
    const onCrtChange = jest.fn();
    render(<ThemeSelector onCrtChange={onCrtChange} />);

    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: CRT_PHOSPHOR_STORAGE_KEY,
          newValue: "true",
        }),
      );
    });

    const crtBtn = screen.getByTestId("cockpit-crt-toggle");
    expect(crtBtn).toHaveAttribute("aria-checked", "true");
    expect(onCrtChange).toHaveBeenCalledWith(true);
  });

  it("synchronizes on custom window events", () => {
    const onCursorChange = jest.fn();
    render(<ThemeSelector onCursorChange={onCursorChange} />);

    act(() => {
      window.dispatchEvent(
        new CustomEvent("worksphere_hud_cursor_change", { detail: true }),
      );
    });

    const cursorBtn = screen.getByTestId("tactical-hud-cursor-toggle");
    expect(cursorBtn).toHaveAttribute("aria-checked", "true");
    expect(onCursorChange).toHaveBeenCalledWith(true);
  });

  it("removes event listeners on unmount", () => {
    const removeEventListenerSpy = jest.spyOn(window, "removeEventListener");
    const { unmount } = render(<ThemeSelector />);

    unmount();
    expect(removeEventListenerSpy).toHaveBeenCalledWith("storage", expect.any(Function));
    expect(removeEventListenerSpy).toHaveBeenCalledWith(
      "worksphere_crt_phosphor_change",
      expect.any(Function),
    );
    expect(removeEventListenerSpy).toHaveBeenCalledWith(
      "worksphere_hud_cursor_change",
      expect.any(Function),
    );
  });

  it("applies custom className using cn utility", () => {
    render(<ThemeSelector className="custom-theme-selector-class" />);

    expect(screen.getByTestId("theme-selector-container")).toHaveClass(
      "custom-theme-selector-class",
    );
  });
});
