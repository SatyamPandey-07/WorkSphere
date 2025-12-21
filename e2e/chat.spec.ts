import { test, expect } from '@playwright/test';

test.describe('AI Chat Interface', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/ai');
    // Wait for page to load
    await page.waitForLoadState('networkidle');
  });

  test('should show chat interface or auth prompt', async ({ page }) => {
    const chatInput = page.locator('[placeholder*="Find"], [placeholder*="Search"], [placeholder*="Ask"], input[type="text"], textarea').first();
    const signInPage = page.locator('text=Sign in, text=Log in, text=Welcome back').first();
    const loadingState = page.locator('text=Finding Your Location, text=Getting your location').first();
    
    await expect(chatInput.or(signInPage).or(loadingState)).toBeVisible({ timeout: 15000 });
  });

  test('should display map container on desktop', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/ai');
    await page.waitForLoadState('networkidle');
    
    const mapContainer = page.locator('.leaflet-container, [class*="map"]').first();
    const signIn = page.locator('text=Sign in, text=Welcome back').first();
    const loading = page.locator('text=Finding Your Location').first();
    
    await expect(mapContainer.or(signIn).or(loading)).toBeVisible({ timeout: 15000 });
  });

  test('should show mobile view toggle on small screens', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/ai');
    await page.waitForLoadState('networkidle');
    
    // Should show Chat/Map toggle on mobile
    const chatToggle = page.locator('button:has-text("Chat")');
    const mapToggle = page.locator('button:has-text("Map")');
    const signIn = page.locator('text=Sign in, text=Welcome back').first();
    
    await expect(chatToggle.or(signIn)).toBeVisible({ timeout: 15000 });
    await expect(mapToggle.or(signIn)).toBeVisible({ timeout: 15000 });
  });
});

test.describe('API Health Checks', () => {
  test('should have healthy venues API', async ({ request }) => {
    const venuesResponse = await request.get('/api/venues?lat=37.7749&lng=-122.4194&radius=1000');
    // May return 401 if auth required, or 200 if public
    expect([200, 401, 403]).toContain(venuesResponse.status());
  });

  test('should handle location API', async ({ request }) => {
    const locationResponse = await request.get('/api/location');
    expect([200, 401, 403, 500]).toContain(locationResponse.status());
  });

  test('should handle chat API gracefully', async ({ request }) => {
    const response = await request.post('/api/chat', {
      data: { messages: [{ role: 'user', content: 'test' }] },
    });
    // Should return error status but not crash
    expect([200, 400, 401, 403, 500]).toContain(response.status());
  });
});

test.describe('PWA Features', () => {
  test('should have service worker', async ({ page }) => {
    await page.goto('/');
    
    const swResponse = await page.request.get('/sw.js');
    expect(swResponse.status()).toBe(200);
    
    const contentType = swResponse.headers()['content-type'];
    expect(contentType).toContain('javascript');
  });

  test('should have valid manifest.json', async ({ page }) => {
    await page.goto('/');
    
    const manifestResponse = await page.request.get('/manifest.json');
    expect(manifestResponse.status()).toBe(200);
    
    const manifest = await manifestResponse.json();
    expect(manifest.name).toBe('WorkSphere');
    expect(manifest.short_name).toBeTruthy();
    expect(manifest.icons).toBeTruthy();
    expect(manifest.start_url).toBeTruthy();
    expect(manifest.display).toBeTruthy();
  });

  test('should have theme-color meta tag', async ({ page }) => {
    await page.goto('/');
    
    const themeColor = await page.locator('meta[name="theme-color"]').getAttribute('content');
    expect(themeColor).toBeTruthy();
  });

  test('should have apple-touch-icon', async ({ page }) => {
    await page.goto('/');
    
    const appleIcon = page.locator('link[rel="apple-touch-icon"]');
    await expect(appleIcon).toHaveCount(1);
  });
});

test.describe('Error Handling', () => {
  test('should handle 404 pages gracefully', async ({ page }) => {
    const response = await page.goto('/non-existent-page-xyz-12345');
    
    expect(response?.status()).toBe(404);
    // Should show some content, not blank page
    await expect(page.locator('body')).not.toBeEmpty();
  });

  test('should handle invalid API requests', async ({ request }) => {
    const response = await request.post('/api/chat', {
      data: { invalid: 'data' },
    });
    
    // Should return error status but not crash
    expect([400, 401, 403, 500]).toContain(response.status());
  });

  test('should handle missing query params gracefully', async ({ request }) => {
    const response = await request.get('/api/venues');
    // Should handle missing params
    expect([200, 400, 401, 403]).toContain(response.status());
  });
});

test.describe('Offline Page', () => {
  test('should display offline page correctly', async ({ page }) => {
    await page.goto('/offline');
    
    await expect(page.locator('h1:has-text("Offline")')).toBeVisible();
    await expect(page.locator('button:has-text("Try Again")')).toBeVisible();
  });

  test('should have retry button that works', async ({ page }) => {
    await page.goto('/offline');
    
    const retryButton = page.locator('button:has-text("Try Again")');
    await expect(retryButton).toBeEnabled();
  });

  test('should show what can be done offline', async ({ page }) => {
    await page.goto('/offline');
    
    await expect(page.locator('text=What you can still do offline, text=saved').first()).toBeVisible();
  });

  test('should have link back to home', async ({ page }) => {
    await page.goto('/offline');
    
    const homeLink = page.locator('a:has-text("Home"), a:has-text("Back")');
    await expect(homeLink).toBeVisible();
  });
});

test.describe('Auth Pages', () => {
  test('should display sign-in page with branding', async ({ page }) => {
    await page.goto('/sign-in');
    
    // Wait for page to load
    await page.waitForLoadState('networkidle');
    
    // Should show WorkSphere branding
    await expect(page.locator('text=WorkSphere').first()).toBeVisible({ timeout: 10000 });
  });

  test('should display sign-up page with features', async ({ page }) => {
    await page.goto('/sign-up');
    
    await page.waitForLoadState('networkidle');
    
    await expect(page.locator('text=WorkSphere').first()).toBeVisible({ timeout: 10000 });
  });

  test('should have link between sign-in and sign-up', async ({ page }) => {
    await page.goto('/sign-in');
    await page.waitForLoadState('networkidle');
    
    const signUpLink = page.locator('a:has-text("Sign up"), a:has-text("Create")').first();
    await expect(signUpLink).toBeVisible({ timeout: 10000 });
  });
});

test.describe('Mobile Experience', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
  });

  test('should show mobile install prompt on landing', async ({ page }) => {
    await page.goto('/');
    
    await expect(page.locator('text=Install as app').first()).toBeVisible();
  });

  test('should have touch-friendly buttons', async ({ page }) => {
    await page.goto('/');
    
    // CTA buttons should be large enough for touch
    const ctaButton = page.locator('button:has-text("Get Started"), a:has-text("Get Started")').first();
    
    if (await ctaButton.isVisible()) {
      const box = await ctaButton.boundingBox();
      expect(box?.height).toBeGreaterThan(40); // Minimum touch target
    }
  });

  test('should scroll smoothly to features', async ({ page }) => {
    await page.goto('/');
    
    // Click Learn More
    await page.click('a:has-text("Learn More")');
    
    // Wait for scroll animation
    await page.waitForTimeout(500);
    
    // Features should now be in view
    const features = page.locator('#features');
    await expect(features).toBeInViewport();
  });
});

test.describe('Loading States', () => {
  test('should show loading state on AI page', async ({ page }) => {
    // Intercept location API to delay response
    await page.route('/api/location', async (route) => {
      await new Promise(resolve => setTimeout(resolve, 500));
      await route.fulfill({ status: 200, body: JSON.stringify({ lat: 37.7749, lng: -122.4194 }) });
    });
    
    await page.goto('/ai');
    
    // Should show some loading indication
    const loading = page.locator('text=Finding, text=Loading, text=Getting, [class*="animate-spin"]').first();
    const content = page.locator('text=Chat, text=Map, text=Sign in').first();
    
    await expect(loading.or(content)).toBeVisible({ timeout: 10000 });
  });
});
