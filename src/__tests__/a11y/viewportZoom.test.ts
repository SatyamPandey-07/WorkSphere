jest.mock("@/hooks/usePWA", () => ({
  SyncManager: () => null,
}));

import { viewport } from "@/app/layout";

describe("Root layout viewport zoom accessibility (Issue #9794)", () => {
  it("defines responsive viewport width and initial scale", () => {
    expect(viewport.width).toBe("device-width");
    expect(viewport.initialScale).toBe(1);
  });

  it("does not disable user scaling (WCAG 2.1 SC 1.4.4 Resize Text)", () => {
    // userScalable must not be false
    expect(viewport.userScalable).not.toBe(false);
  });

  it("does not restrict maximum scale to 1 (enabling >= 200% magnification)", () => {
    if (viewport.maximumScale !== undefined) {
      expect(viewport.maximumScale).toBeGreaterThanOrEqual(2);
    } else {
      // Omitting maximumScale allows browser-default zoom levels (up to 500%)
      expect(viewport.maximumScale).toBeUndefined();
    }
  });
});
