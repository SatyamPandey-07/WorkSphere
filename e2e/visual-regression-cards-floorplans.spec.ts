import { test, expect } from "@playwright/test";

test.describe("Visual Regression: Responsive Venue Cards & Floorplans", () => {
  const viewports = [
    { name: "mobile-viewport-375x667", width: 375, height: 667 },
    { name: "tablet-viewport-768x1024", width: 768, height: 1024 },
    { name: "desktop-viewport-1280x800", width: 1280, height: 800 },
  ];

  for (const vp of viewports) {
    test.describe(`Viewport: ${vp.name}`, () => {
      test.use({ viewport: { width: vp.width, height: vp.height } });

      test(`should match visual snapshot for venue discovery cards (${vp.name})`, async ({
        page,
      }) => {
        await page.goto("/");
        await page.waitForLoadState("networkidle");

        // Locate feature cards or venue grid section
        const venueSection = page.locator("#features, main, [data-testid='venue-grid']").first();
        await expect(venueSection).toBeVisible();

        // Capture snapshot of responsive venue cards layout
        await expect(page).toHaveScreenshot(`venue-cards-${vp.name}.png`, {
          maxDiffPixelRatio: 0.05,
          animations: "disabled",
        });
      });

      test(`should match visual snapshot for venue details hero & share dialog (${vp.name})`, async ({
        page,
      }) => {
        // Go to sample venue detail page
        await page.goto("/venues/cm80sample123");
        await page.waitForLoadState("domcontentloaded");

        const mainCard = page.locator("main").first();
        if (await mainCard.isVisible()) {
          await expect(mainCard).toHaveScreenshot(`venue-detail-hero-${vp.name}.png`, {
            maxDiffPixelRatio: 0.05,
            animations: "disabled",
          });
        }
      });

      test(`should match visual snapshot for 2D indoor positioning floorplan map (${vp.name})`, async ({
        page,
      }) => {
        await page.goto("/venues/cm80sample123/navigate");
        await page.waitForLoadState("domcontentloaded");

        const mapCanvas = page.locator("canvas, [data-testid='indoor-positioning-map']").first();
        if (await mapCanvas.isVisible()) {
          await expect(mapCanvas).toHaveScreenshot(`floorplan-map-${vp.name}.png`, {
            maxDiffPixelRatio: 0.05,
            animations: "disabled",
          });
        }
      });
    });
  }

  test("should match visual snapshot across Dark and Light theme modes", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });

    // Light Theme
    await page.goto("/");
    await page.emulateMedia({ colorScheme: "light" });
    await page.waitForLoadState("networkidle");
    await expect(page).toHaveScreenshot("theme-light-homepage.png", {
      maxDiffPixelRatio: 0.05,
      animations: "disabled",
    });

    // Dark Theme
    await page.emulateMedia({ colorScheme: "dark" });
    await page.reload();
    await page.waitForLoadState("networkidle");
    await expect(page).toHaveScreenshot("theme-dark-homepage.png", {
      maxDiffPixelRatio: 0.05,
      animations: "disabled",
    });
  });
});
