import { trackSearch, trackVenueInteraction, trackFilterApplied, trackError } from '@/lib/analytics';

// Mock process.env
const originalEnv = process.env;

describe('Analytics', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Set development mode to enable console logging
    process.env = { ...originalEnv, NODE_ENV: 'development' };
    // Mock console.log to verify logging
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
    process.env = originalEnv;
  });

  describe('trackSearch', () => {
    it('tracks search queries with location', () => {
      trackSearch('coffee shops', { lat: 37.7749, lng: -122.4194 });
      expect(console.log).toHaveBeenCalledWith(
        '[Analytics]',
        'search_performed',
        expect.objectContaining({
          query: 'coffee shops',
        })
      );
    });
  });

  describe('trackVenueInteraction', () => {
    it('tracks venue views', () => {
      trackVenueInteraction('viewed', { id: 'venue-123', name: 'Test Cafe', category: 'cafe' });
      expect(console.log).toHaveBeenCalledWith(
        '[Analytics]',
        'venue_viewed',
        expect.objectContaining({
          venueId: 'venue-123',
        })
      );
    });

    it('tracks favorites', () => {
      trackVenueInteraction('favorited', { id: 'venue-123', name: 'Test Cafe', category: 'cafe' });
      expect(console.log).toHaveBeenCalledWith(
        '[Analytics]',
        'venue_favorited',
        expect.objectContaining({
          venueId: 'venue-123',
        })
      );
    });
  });

  describe('trackFilterApplied', () => {
    it('tracks filter applications', () => {
      const filters = { wifi: true, outlets: true };
      trackFilterApplied(filters);
      expect(console.log).toHaveBeenCalledWith(
        '[Analytics]',
        'filter_applied',
        expect.objectContaining({
          filters: ['wifi', 'outlets'],
        })
      );
    });
  });

  describe('trackError', () => {
    it('tracks errors with Error object', () => {
      const error = new Error('Test error message');
      trackError(error, 'TestContext');
      expect(console.log).toHaveBeenCalledWith(
        '[Analytics]',
        'error_occurred',
        expect.objectContaining({
          message: 'Test error message',
          context: 'TestContext',
        })
      );
    });
  });
});
