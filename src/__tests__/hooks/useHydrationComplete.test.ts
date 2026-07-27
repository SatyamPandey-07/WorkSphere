import { renderHook, waitFor } from "@testing-library/react";
import fs from "fs";
import path from "path";
import {
  useHydrationComplete,
  useIsHydrated,
} from "../../hooks/useHydrationComplete";

describe("useHydrationComplete (#1033)", () => {
  it("reports hydrated on the client via useIsHydrated", () => {
    const { result } = renderHook(() => useIsHydrated());
    expect(result.current).toBe(true);
  });

  it("becomes true only after the hydration effect runs", async () => {
    const { result } = renderHook(() => useHydrationComplete());

    await waitFor(() => {
      expect(result.current).toBe(true);
    });
  });
});

describe("WebSocket listener deferral contract (#1033)", () => {
  it("gates EnhancedChatbot message listeners on isHydrated", () => {
    const chatbot = fs.readFileSync(
      path.join(__dirname, "../../components/EnhancedChatbot.tsx"),
      "utf8",
    );

    expect(chatbot).toMatch(/isHydrated/);
    expect(chatbot).toMatch(
      /if\s*\(\s*!isHydrated\s*\|\|\s*!socket\s*\)\s*return/,
    );
    expect(chatbot).toMatch(/socket\.addEventListener\(\s*["']message["']/);
  });

  it("keeps PartySocket closed until hydration in useMultiplayerSession", () => {
    const realtime = fs.readFileSync(
      path.join(__dirname, "../../hooks/useRealTime.tsx"),
      "utf8",
    );

    expect(realtime).toMatch(/useHydrationComplete/);
    expect(realtime).toMatch(/startClosed:\s*!isHydrated/);
  });
});
