import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { TOGGLE_CHATBOT_EVENT, toggleChatbot } from "@/hooks/usePlatformModifier";

// Mock next/navigation
jest.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/ai",
  useRouter: () => ({ push: jest.fn() }),
}));

// Mock dynamic imports
jest.mock("next/dynamic", () => () => {
  return function MockDynamicComponent() {
    return <div data-testid="mock-dynamic">Mock Dynamic</div>;
  };
});

describe("AI Chatbot shortcut & triggers", () => {
  it("dispatches and responds to TOGGLE_CHATBOT_EVENT", () => {
    let isOpen = false;
    const toggleListener = jest.fn(() => {
      isOpen = !isOpen;
    });

    window.addEventListener(TOGGLE_CHATBOT_EVENT, toggleListener);

    toggleChatbot();
    expect(toggleListener).toHaveBeenCalledTimes(1);
    expect(isOpen).toBe(true);

    toggleChatbot();
    expect(toggleListener).toHaveBeenCalledTimes(2);
    expect(isOpen).toBe(false);

    window.removeEventListener(TOGGLE_CHATBOT_EVENT, toggleListener);
  });

  it("handles Ctrl+/ and Cmd+/ keyboard events", () => {
    let isSidebarOpen = true;
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement as HTMLElement | null;
      const isTyping =
        activeEl &&
        (activeEl.tagName === "INPUT" ||
          activeEl.tagName === "TEXTAREA" ||
          activeEl.getAttribute("contenteditable") === "true");

      if (isTyping) return;

      if ((e.ctrlKey || e.metaKey) && (e.key === "/" || e.code === "Slash")) {
        e.preventDefault();
        isSidebarOpen = !isSidebarOpen;
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    // Trigger with Ctrl+/
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "/",
        ctrlKey: true,
        bubbles: true,
      })
    );
    expect(isSidebarOpen).toBe(false);

    // Trigger with Meta+/ (Mac Cmd+/)
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "/",
        metaKey: true,
        bubbles: true,
      })
    );
    expect(isSidebarOpen).toBe(true);

    window.removeEventListener("keydown", handleKeyDown);
  });
});
