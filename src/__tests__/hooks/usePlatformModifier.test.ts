import { renderHook } from "@testing-library/react";
import {
  isMacPlatform,
  getPlatformModifier,
  usePlatformModifier,
  openCommandPalette,
  toggleChatbot,
  OPEN_COMMAND_PALETTE_EVENT,
  TOGGLE_CHATBOT_EVENT,
} from "@/hooks/usePlatformModifier";

describe("usePlatformModifier & helpers", () => {
  describe("isMacPlatform", () => {
    it("detects Mac from userAgent", () => {
      expect(isMacPlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)")).toBe(true);
      expect(isMacPlatform("Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X)")).toBe(true);
      expect(isMacPlatform("Mozilla/5.0 (iPad; CPU OS 13_2 like Mac OS X)")).toBe(true);
    });

    it("detects non-Mac (Windows, Linux, Android) correctly", () => {
      expect(isMacPlatform("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe(false);
      expect(isMacPlatform("Mozilla/5.0 (X11; Linux x86_64)")).toBe(false);
      expect(isMacPlatform("Mozilla/5.0 (Linux; Android 10)")).toBe(false);
    });

    it("falls back gracefully when userAgent is empty", () => {
      expect(isMacPlatform("", "")).toBe(false);
    });
  });

  describe("getPlatformModifier", () => {
    it("returns Cmd / ⌘ metadata for Mac", () => {
      const res = getPlatformModifier("Mozilla/5.0 (Macintosh; Intel Mac OS X)");
      expect(res.isMac).toBe(true);
      expect(res.modifierSymbol).toBe("⌘");
      expect(res.modifierLabel).toBe("Cmd");
      expect(res.modifierKey).toBe("Meta");
    });

    it("returns Ctrl metadata for Windows/Linux", () => {
      const res = getPlatformModifier("Mozilla/5.0 (Windows NT 10.0)");
      expect(res.isMac).toBe(false);
      expect(res.modifierSymbol).toBe("Ctrl");
      expect(res.modifierLabel).toBe("Ctrl");
      expect(res.modifierKey).toBe("Control");
    });
  });

  describe("usePlatformModifier hook", () => {
    it("provides formatShortcut and getAriaKeyshortcuts", () => {
      const { result } = renderHook(() => usePlatformModifier());

      expect(typeof result.current.formatShortcut).toBe("function");
      expect(typeof result.current.getAriaKeyshortcuts).toBe("function");

      const ariaK = result.current.getAriaKeyshortcuts("K");
      expect(ariaK).toBe("Control+K Meta+K");

      const ariaSlash = result.current.getAriaKeyshortcuts("/");
      expect(ariaSlash).toBe("Control+/ Meta+/");
    });

    it("formats shortcuts with default separator", () => {
      const { result } = renderHook(() => usePlatformModifier());
      const formatted = result.current.formatShortcut("K");
      expect(formatted).toMatch(/(Ctrl \+ K|Cmd \+ K)/);
    });
  });

  describe("Event dispatchers", () => {
    it("openCommandPalette dispatches OPEN_COMMAND_PALETTE_EVENT", () => {
      const listener = jest.fn();
      window.addEventListener(OPEN_COMMAND_PALETTE_EVENT, listener);

      openCommandPalette();

      expect(listener).toHaveBeenCalled();
      window.removeEventListener(OPEN_COMMAND_PALETTE_EVENT, listener);
    });

    it("toggleChatbot dispatches TOGGLE_CHATBOT_EVENT", () => {
      const listener = jest.fn();
      window.addEventListener(TOGGLE_CHATBOT_EVENT, listener);

      toggleChatbot();

      expect(listener).toHaveBeenCalled();
      window.removeEventListener(TOGGLE_CHATBOT_EVENT, listener);
    });
  });
});
