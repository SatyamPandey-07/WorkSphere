import { test, expect } from '@playwright/test';

test.describe('User Journey - First Time Visitor', () => {
  test('should guide user from landing to sign up', async ({ page }) => {
    // Start at landing page
    await page.goto('/');
    
    // Verify landing page loaded
    await expect(page.locator('h1')).toContainText('Find Your Perfect');
    
    // Click Get Started
    const getStartedBtn = page.locator('button:has-text("Get Started"), a:has-text("Get Started")').first();
    await expect(getStartedBtn).toBeVisible();
    
    // Click should either open modal or navigate
    await getStartedBtn.click();
    
    // Should show sign up modal or navigate to sign up
    await page.waitForTimeout(500);
    
    const signUpForm = page.locator('text=Create, text=Sign up, text=Email').first();
    await expect(signUpForm).toBeVisible({ timeout: 10000 });
  });

  test('should allow exploring features without auth', async ({ page }) => {
    await page.goto('/');
    
    // Click Learn More
    await page.click('a:has-text("Learn More")');
    
    // Should scroll to features
    await page.waitForTimeout(500);
    
    // Features should be visible
    await expect(page.locator('text=WiFi Quality')).toBeVisible();
    await expect(page.locator('text=Noise Levels')).toBeVisible();
    
    // Continue scrolling to How It Works
    const howItWorks = page.locator('h2:has-text("How It Works")');
    await howItWorks.scrollIntoViewIfNeeded();
    await expect(howItWorks).toBeVisible();
    
    // Scroll to CTA
    const cta = page.locator('text=Ready to Find Your Perfect Workspace');
    await cta.scrollIntoViewIfNeeded();
    await expect(cta).toBeVisible();
  });
});

test.describe('User Journey - Navigation Flow', () => {
  test('should navigate between pages correctly', async ({ page }) => {
    // Start at home
    await page.goto('/');
    await expect(page.locator('text=WorkSphere').first()).toBeVisible();
    
    // Go to offline (for testing without auth)
    await page.goto('/offline');
    await expect(page.locator('h1:has-text("Offline")')).toBeVisible();
    
    // Click Back to Home
    await page.click('a:has-text("Home"), a:has-text("Back")');
    
    // Should be back at landing
    await expect(page.locator('h1')).toContainText('Find Your Perfect');
  });

  test('should handle browser back/forward', async ({ page }) => {
    await page.goto('/');
    await page.goto('/offline');
    
    // Go back
    await page.goBack();
    await expect(page).toHaveURL('/');
    
    // Go forward
    await page.goForward();
    await expect(page).toHaveURL('/offline');
  });
});

test.describe('Interactive Elements', () => {
  test('should handle CTA button hover states', async ({ page }) => {
    await page.goto('/');
    
    const getStartedBtn = page.locator('button:has-text("Get Started")').first();
    
    if (await getStartedBtn.isVisible()) {
      // Hover over button
      await getStartedBtn.hover();
      
      // Button should still be visible and interactive
      await expect(getStartedBtn).toBeVisible();
    }
  });

  test('should show focus states on keyboard navigation', async ({ page }) => {
    await page.goto('/');
    
    // Tab to first interactive element
    await page.keyboard.press('Tab');
    
    // Should have focus ring
    const focused = page.locator(':focus');
    await expect(focused).toBeVisible();
    
    // Continue tabbing
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press('Tab');
      const currentFocus = page.locator(':focus');
      await expect(currentFocus).toBeVisible();
    }
  });

  test('should handle smooth scroll animation', async ({ page }) => {
    await page.goto('/');
    
    // Get initial scroll position
    const initialScroll = await page.evaluate(() => window.scrollY);
    
    // Click Learn More (should smooth scroll)
    await page.click('a:has-text("Learn More")');
    
    // Wait for scroll
    await page.waitForTimeout(800);
    
    // Should have scrolled
    const newScroll = await page.evaluate(() => window.scrollY);
    expect(newScroll).toBeGreaterThan(initialScroll);
  });
});

test.describe('Form Interactions', () => {
  test('should handle sign-in form interaction', async ({ page }) => {
    await page.goto('/sign-in');
    await page.waitForLoadState('networkidle');
    
    // Find email input (Clerk renders this)
    const emailInput = page.locator('input[type="email"], input[name="identifier"], input[name="email"]').first();
    
    if (await emailInput.isVisible({ timeout: 5000 }).catch(() => false)) {
      // Type in email field
      await emailInput.fill('test@example.com');
      await expect(emailInput).toHaveValue('test@example.com');
      
      // Clear and try again
      await emailInput.clear();
      await expect(emailInput).toHaveValue('');
    }
  });
});

test.describe('State Persistence', () => {
  test('should remember last online time on offline page', async ({ page, context }) => {
    // Set localStorage before visiting offline page
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.setItem('lastOnline', new Date().toISOString());
    });
    
    // Go to offline page
    await page.goto('/offline');
    
    // Should show last connected time
    const lastConnected = page.locator('text=Last connected');
    await expect(lastConnected).toBeVisible();
  });
});

test.describe('Feature Cards Interaction', () => {
  test('should have hoverable feature cards', async ({ page }) => {
    await page.goto('/');
    
    // Scroll to features
    await page.locator('#features').scrollIntoViewIfNeeded();
    
    // Find a feature card
    const featureCard = page.locator('text=WiFi Quality').locator('..').first();
    
    // Hover over it
    await featureCard.hover();
    
    // Card should still be visible (hover effects don't break it)
    await expect(featureCard).toBeVisible();
  });

  test('should display all feature icons', async ({ page }) => {
    await page.goto('/');
    
    // Check that feature cards have icons (svg elements)
    const features = page.locator('#features');
    await features.scrollIntoViewIfNeeded();
    
    // Each feature card should have an icon
    const cards = features.locator('> div > div');
    const cardCount = await cards.count();
    
    expect(cardCount).toBe(6); // 6 feature cards
  });
});

test.describe('Footer', () => {
  test('should display footer content', async ({ page }) => {
    await page.goto('/');
    
    // Scroll to footer
    await page.locator('footer').scrollIntoViewIfNeeded();
    
    await expect(page.locator('footer')).toBeVisible();
    await expect(page.locator('footer').locator('text=WorkSphere')).toBeVisible();
    await expect(page.locator('text=© 2024').first()).toBeVisible();
  });
});

test.describe('Network Conditions', () => {
  test('should handle slow network gracefully', async ({ page, context }) => {
    // Slow down network
    const client = await context.newCDPSession(page);
    await client.send('Network.emulateNetworkConditions', {
      offline: false,
      downloadThroughput: 50 * 1024, // 50kb/s
      uploadThroughput: 50 * 1024,
      latency: 500,
    });
    
    // Page should still load (eventually)
    await page.goto('/', { timeout: 30000 });
    
    await expect(page.locator('text=WorkSphere').first()).toBeVisible({ timeout: 15000 });
  });
});
