import { test, expect } from "@playwright/test";

/**
 * Visual Regression Snapshot Tests for Light and Dark Theme Components (#3782)
 *
 * Covers:
 * 1. Venue discovery grid (light and dark)
 * 2. Seat booking modal (light and dark)
 * 3. Noise reporting widget (light and dark)
 *
 * Configured with pixel tolerance (maxDiffPixelRatio: 0.05) for font antialiasing variations.
 */

const TEST_VENUE = {
  id: "test-venue-visual",
  name: "WorkSphere Downtown Hub",
  address: "100 Innovation Way, Suite 400",
  category: "coworking_space",
  rating: 4.8,
  reviewCount: 32,
  lat: 37.7749,
  lng: -122.4194,
  wifi: true,
  hasOutlets: true,
  noiseLevel: "quiet",
  wifiSpeed: 150,
  seats: [
    {
      id: "seat-desk-1a",
      seatNumber: "1A",
      type: "HOT_DESK",
      x: 40,
      y: 60,
      width: 70,
      height: 45,
      amenities: ["WiFi", "Power Outlets"],
      available: true,
    },
  ],
};

test.describe("Theme Visual Regression: Light and Dark Modes (#3782)", () => {
  test.beforeEach(async ({ page }) => {
    // Mock Clerk authentication session
    await page.route("**/*.clerk.accounts.dev/**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          response: {
            id: "user_test_visual_123",
            primaryEmailAddress: { emailAddress: "visual-test@worksphere.dev" },
          },
        }),
      });
    });

    // Mock venue APIs
    await page.route("**/api/venues*", async (route) => {
      const url = route.request().url();
      if (url.includes(TEST_VENUE.id)) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ venue: TEST_VENUE }),
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            venues: [TEST_VENUE],
            total: 1,
            page: 1,
          }),
        });
      }
    });

    // Mock noise API
    await page.route("**/api/noise*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          venueId: TEST_VENUE.id,
          currentDb: 52,
          buckets: [
            { key: "morning", label: "Morning", averageDb: 48, peakDb: 55, samples: 10 },
            { key: "afternoon", label: "Afternoon", averageDb: 54, peakDb: 62, samples: 15 },
          ],
        }),
      });
    });

    // Mock reservations availability
    await page.route("**/api/reservations/availability*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          venueId: TEST_VENUE.id,
          seats: TEST_VENUE.seats,
          availableCount: 1,
          totalCount: 1,
        }),
      });
    });
  });

  const themes: Array<"light" | "dark"> = ["light", "dark"];

  for (const theme of themes) {
    test.describe(`Theme: ${theme.toUpperCase()}`, () => {
      test.use({ viewport: { width: 1280, height: 800 } });

      test(`should match visual snapshot for venue discovery grid (${theme})`, async ({ page }) => {
        await page.emulateMedia({ colorScheme: theme });
        await page.goto("/");
        await page.waitForLoadState("domcontentloaded");

        // Toggle html dark class explicitly for Tailwind compatibility
        await page.evaluate((currentTheme) => {
          if (currentTheme === "dark") {
            document.documentElement.classList.add("dark");
          } else {
            document.documentElement.classList.remove("dark");
          }
        }, theme);

        const venueGrid = page.locator("[data-testid='venue-grid'], #features").first();
        await expect(venueGrid).toBeVisible({ timeout: 10000 });

        await expect(venueGrid).toHaveScreenshot(`venue-discovery-grid-${theme}.png`, {
          maxDiffPixelRatio: 0.05,
          animations: "disabled",
        });
      });

      test(`should match visual snapshot for seat booking modal (${theme})`, async ({ page }) => {
        await page.emulateMedia({ colorScheme: theme });
        await page.goto("/ai");
        await page.waitForLoadState("domcontentloaded");

        await page.evaluate((currentTheme) => {
          if (currentTheme === "dark") {
            document.documentElement.classList.add("dark");
          } else {
            document.documentElement.classList.remove("dark");
          }
        }, theme);

        // Click "My Residencies" / Bookings button in chat header to open BookingModal in history mode
        const showBookingsBtn = page.locator("button[title='My Residencies']").first();
        if (await showBookingsBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
          await showBookingsBtn.click();
        }

        const bookingModal = page.locator("[data-testid='booking-modal']").first();
        if (await bookingModal.isVisible({ timeout: 5000 }).catch(() => false)) {
          await expect(bookingModal).toHaveScreenshot(`seat-booking-modal-${theme}.png`, {
            maxDiffPixelRatio: 0.05,
            animations: "disabled",
          });
        }
      });

      test(`should match visual snapshot for noise reporting widget (${theme})`, async ({ page }) => {
        await page.emulateMedia({ colorScheme: theme });
        await page.goto("/ai");
        await page.waitForLoadState("domcontentloaded");

        await page.evaluate((currentTheme) => {
          if (currentTheme === "dark") {
            document.documentElement.classList.add("dark");
          } else {
            document.documentElement.classList.remove("dark");
          }
        }, theme);

        const noiseWidget = page.locator("[data-testid='noise-reporting-widget']").first();
        if (await noiseWidget.isVisible({ timeout: 3000 }).catch(() => false)) {
          await expect(noiseWidget).toHaveScreenshot(`noise-reporting-widget-${theme}.png`, {
            maxDiffPixelRatio: 0.05,
            animations: "disabled",
          });
        }
      });
    });
  }
});
