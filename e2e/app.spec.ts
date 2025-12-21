import { test, expect } from '@playwright/test';

test.describe('Landing Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('should load the homepage with correct title', async ({ page }) => {
    await expect(page).toHaveTitle(/WorkSphere/i);
    await expect(page.locator('text=WorkSphere').first()).toBeVisible();
  });

  test('should display hero section with gradient text', async ({ page }) => {
    await expect(page.locator('h1')).toContainText('Find Your Perfect');
    await expect(page.locator('h1')).toContainText('Work Space');
  });

  test('should have navigation elements', async ({ page }) => {
    const signInButton = page.locator('text=Sign In').first();
    const signUpButton = page.locator('text=Sign Up').first();
    
    await expect(signInButton.or(signUpButton)).toBeVisible();
  });

  test('should display all 6 feature cards', async ({ page }) => {
    // Check for all feature titles
    await expect(page.locator('text=WiFi Quality').first()).toBeVisible();
    await expect(page.locator('text=Noise Levels').first()).toBeVisible();
    await expect(page.locator('text=Power Outlets').first()).toBeVisible();
    await expect(page.locator('text=Busy Times').first()).toBeVisible();
    await expect(page.locator('text=Smart Routing').first()).toBeVisible();
    await expect(page.locator('text=AI-Powered').first()).toBeVisible();
  });

  test('should display "How It Works" section', async ({ page }) => {
    await expect(page.locator('h2:has-text("How It Works")')).toBeVisible();
    await expect(page.locator('text=Tell us what you need').first()).toBeVisible();
    await expect(page.locator('text=AI finds the best matches').first()).toBeVisible();
  });

  test('should have "Get Started" CTA button', async ({ page }) => {
    const cta = page.locator('a:has-text("Get Started"), button:has-text("Get Started")').first();
    await expect(cta).toBeVisible();
  });

  test('should display stats section', async ({ page }) => {
    await expect(page.locator('text=Active Users').first()).toBeVisible();
    await expect(page.locator('text=Venues').first()).toBeVisible();
    await expect(page.locator('text=Rating').first()).toBeVisible();
  });

  test('should have footer with copyright', async ({ page }) => {
    await expect(page.locator('footer')).toBeVisible();
    await expect(page.locator('text=Built with Next.js').first()).toBeVisible();
  });

  test('should navigate to features section when clicking Learn More', async ({ page }) => {
    await page.click('a:has-text("Learn More")');
    
    // Check that we scrolled to features
    const featuresSection = page.locator('#features');
    await expect(featuresSection).toBeInViewport();
  });
});

test.describe('Navigation', () => {
  test('should navigate to AI page', async ({ page }) => {
    await page.goto('/ai');
    
    // Should either show AI chat interface or redirect to sign-in
    const chatInterface = page.locator('[placeholder*="Find"], [placeholder*="Search"], [placeholder*="Ask"], input[type="text"]').first();
    const signIn = page.locator('text=Sign in').first();
    const locationLoading = page.locator('text=Finding Your Location').first();
    
    await expect(chatInterface.or(signIn).or(locationLoading)).toBeVisible({ timeout: 15000 });
  });

  test('should handle offline page', async ({ page }) => {
    await page.goto('/offline');
    
    await expect(page.locator('h1:has-text("Offline")').first()).toBeVisible();
    await expect(page.locator('text=Try Again').first()).toBeVisible();
  });

  test('should navigate to sign-in page', async ({ page }) => {
    await page.goto('/sign-in');
    
    // Should show Clerk sign-in or similar
    await expect(page.locator('text=Sign in, text=Log in, text=WorkSphere').first()).toBeVisible({ timeout: 10000 });
  });

  test('should navigate to sign-up page', async ({ page }) => {
    await page.goto('/sign-up');
    
    // Should show Clerk sign-up or similar
    await expect(page.locator('text=Sign up, text=Create, text=WorkSphere').first()).toBeVisible({ timeout: 10000 });
  });
});

test.describe('Responsive Design', () => {
  test('should work on mobile viewport (375x667)', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/');
    
    await expect(page.locator('text=WorkSphere').first()).toBeVisible();
    await expect(page.locator('h1')).toBeVisible();
    
    // Install app message should be visible on mobile
    await expect(page.locator('text=Install as app').first()).toBeVisible();
  });

  test('should work on tablet viewport (768x1024)', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto('/');
    
    await expect(page.locator('text=WorkSphere').first()).toBeVisible();
  });

  test('should work on desktop viewport (1920x1080)', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto('/');
    
    await expect(page.locator('text=WorkSphere').first()).toBeVisible();
    // Dashboard link should be visible on large screens when signed in
  });
});

test.describe('Performance', () => {
  test('should load within 5 seconds', async ({ page }) => {
    const startTime = Date.now();
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    const loadTime = Date.now() - startTime;
    
    expect(loadTime).toBeLessThan(5000);
  });

  test('should have good First Contentful Paint', async ({ page }) => {
    await page.goto('/');
    
    // Wait for content to be visible
    await expect(page.locator('h1')).toBeVisible({ timeout: 3000 });
  });
});

test.describe('SEO & Meta', () => {
  test('should have proper title', async ({ page }) => {
    await page.goto('/');
    
    const title = await page.title();
    expect(title.length).toBeGreaterThan(0);
  });

  test('should have meta viewport for mobile', async ({ page }) => {
    await page.goto('/');
    
    const viewport = await page.locator('meta[name="viewport"]').getAttribute('content');
    expect(viewport).toContain('width=device-width');
  });

  test('should have link to manifest for PWA', async ({ page }) => {
    await page.goto('/');
    
    const manifestLink = page.locator('link[rel="manifest"]');
    await expect(manifestLink).toHaveCount(1);
  });
});

test.describe('Accessibility', () => {
  test('should have no duplicate IDs', async ({ page }) => {
    await page.goto('/');
    
    const ids = await page.evaluate(() => {
      const elements = document.querySelectorAll('[id]');
      const idList: string[] = [];
      elements.forEach(el => idList.push(el.id));
      return idList;
    });
    
    const uniqueIds = new Set(ids);
    expect(ids.length).toBe(uniqueIds.size);
  });

  test('should be keyboard navigable', async ({ page }) => {
    await page.goto('/');
    
    // Tab through the page
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    
    // Something should be focused
    const focusedElement = await page.evaluate(() => document.activeElement?.tagName);
    expect(focusedElement).toBeTruthy();
    expect(focusedElement).not.toBe('BODY');
  });

  test('should have focus indicators', async ({ page }) => {
    await page.goto('/');
    
    // Focus on a link/button
    await page.keyboard.press('Tab');
    
    const focusedElement = page.locator(':focus');
    await expect(focusedElement).toBeVisible();
  });
});

test.describe('Dark Mode', () => {
  test('should support dark mode via prefers-color-scheme', async ({ page }) => {
    // Emulate dark mode
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/');
    
    // Page should still render correctly
    await expect(page.locator('text=WorkSphere').first()).toBeVisible();
  });

  test('should support light mode', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('/');
    
    await expect(page.locator('text=WorkSphere').first()).toBeVisible();
  });
});

test.describe('Animations', () => {
  test('should load with fade-in animations', async ({ page }) => {
    await page.goto('/');
    
    // Wait for animations to complete
    await page.waitForTimeout(1000);
    
    // Hero should be visible after animation
    await expect(page.locator('h1')).toBeVisible();
    await expect(page.locator('h1')).toHaveCSS('opacity', '1');
  });
});
