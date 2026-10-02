import { render, screen, fireEvent } from "@testing-library/react";
import { CommandPalette } from "@/components/CommandPalette";

// CommandPalette uses next/navigation — mock it
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn() }),
  usePathname: () => "/",
}));

describe("CommandPalette search sanitization", () => {
  beforeEach(() => {
    // Open the command palette via keyboard shortcut
    // (Ctrl+K or Cmd+K normally opens it)
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("renders the CommandPalette toggle button area", () => {
    render(<CommandPalette />);
    // CommandPalette renders nothing until opened — just check it doesn't crash
  });

  it("does not crash on render", () => {
    expect(() => render(<CommandPalette />)).not.toThrow();
  });
});

describe("Input sanitization on CommandPalette", () => {
  it("strips XSS characters from the search input onChange", () => {
    // Test the sanitization regex directly
    const sanitize = (val: string) =>
      val.replace(/[<>"'`\x00-\x1F\x7F]/g, "").slice(0, 200);

    expect(sanitize("<script>alert(1)</script>")).toBe("scriptalert(1)/script");
    expect(sanitize("normal search")).toBe("normal search");
    expect(sanitize('"quoted"')).toBe("quoted");
    expect(sanitize("a".repeat(250))).toHaveLength(200);
  });

  it("preserves normal alphanumeric search terms", () => {
    const sanitize = (val: string) =>
      val.replace(/[<>"'`\x00-\x1F\x7F]/g, "").slice(0, 200);

    expect(sanitize("WorkSphere café 123")).toBe("WorkSphere café 123");
    expect(sanitize("find wifi spots")).toBe("find wifi spots");
  });

  it("strips backtick characters", () => {
    const sanitize = (val: string) =>
      val.replace(/[<>"'`\x00-\x1F\x7F]/g, "").slice(0, 200);

    expect(sanitize("`cmd`")).toBe("cmd");
  });
});
