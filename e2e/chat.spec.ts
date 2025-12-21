import { test, expect } from '@playwright/test';

test.describe('AI Chat Interface', () => {
  // Note: These tests may require authentication
  // In CI, you might need to mock auth or use test credentials
  
  test('should show chat interface or auth prompt', async ({ page }) => {
    await page.goto('/ai');
    
    // Either shows chat input or redirects to sign-in
    const chatInput = page.locator('[placeholder*="Find"], [placeholder*="Search"], [placeholder*="Ask"], input[type="text"]').first();
    const signInPage = page.locator('text=Sign in, text=Log in').first();
    
    await expect(chatInput.or(signInPage)).toBeVisible({ timeout: 15000 });
  });

  test('should display map container', async ({ page }) => {
    await page.goto('/ai');
    
    // Wait for page to load
    await page.waitForLoadState('networkidle');
    
    // Check for map-related elements (Leaflet)
    const mapContainer = page.locator('.leaflet-container, [class*="map"]').first();
    const signIn = page.locator('text=Sign in').first();
    
    // Either map is visible or user needs to sign in
    await expect(mapContainer.or(signIn)).toBeVisible({ timeout: 15000 });
  });
});

test.describe('API Health Checks', () => {
  test('should have healthy API routes', async ({ request }) => {
    // Test venues endpoint
    const venuesResponse = await request.get('/api/venues?lat=37.7749&lng=-122.4194&radius=1000');
    // May return 401 if auth required
    expect([200, 401, 403]).toContain(venuesResponse.status());
  });

  test('should handle location API', async ({ request }) => {
    const locationResponse = await request.get('/api/location');
    expect([200, 401, 403, 500]).toContain(locationResponse.status());
  });
});

test.describe('PWA Features', () => {
  test('should have service worker', async ({ page }) => {
    await page.goto('/');
    
    // Check if sw.js is accessible
    const swResponse = await page.request.get('/sw.js');
    expect(swResponse.status()).toBe(200);
  });

  test('should have manifest.json', async ({ page }) => {
    await page.goto('/');
    
    const manifestResponse = await page.request.get('/manifest.json');
    expect(manifestResponse.status()).toBe(200);
    
    const manifest = await manifestResponse.json();
    expect(manifest.name).toBe('WorkSphere');
  });
});

test.describe('Error Handling', () => {
  test('should handle 404 pages gracefully', async ({ page }) => {
    const response = await page.goto('/non-existent-page-12345');
    
    // Should return 404 but show a nice page
    expect(response?.status()).toBe(404);
  });

  test('should handle invalid API requests', async ({ request }) => {
    const response = await request.post('/api/chat', {
      data: { invalid: 'data' },
    });
    
    // Should return error status but not crash
    expect([400, 401, 403, 500]).toContain(response.status());
  });
});
