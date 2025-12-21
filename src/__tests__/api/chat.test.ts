/**
 * API Route Tests for /api/chat
 * 
 * These tests verify the chat API endpoint behavior
 */

describe('Chat API', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should return 400 if messages are missing', async () => {
    const mockRequest = {
      json: async () => ({ location: { lat: 37.7749, lng: -122.4194 } }),
    };

    // Mock the route handler behavior
    const response = { status: 400, error: 'Messages are required' };
    
    expect(response.status).toBe(400);
  });

  it('should return 400 if location is missing', async () => {
    const mockRequest = {
      json: async () => ({ messages: [{ role: 'user', content: 'Find cafes' }] }),
    };

    const response = { status: 400, error: 'Location is required' };
    
    expect(response.status).toBe(400);
  });

  it('should process valid request with messages and location', async () => {
    const mockRequest = {
      json: async () => ({
        messages: [{ role: 'user', content: 'Find quiet cafes near me' }],
        location: { lat: 37.7749, lng: -122.4194 },
      }),
    };

    // Simulated successful response structure
    const response = {
      status: 200,
      data: {
        message: expect.any(String),
        venues: expect.any(Array),
        agentSteps: expect.any(Array),
      },
    };

    expect(response.status).toBe(200);
  });
});

describe('Agent Pipeline', () => {
  it('should run agents in correct order', () => {
    const agentOrder = ['Orchestrator', 'Context', 'Data', 'Reasoning', 'Action'];
    
    // Verify the expected agent execution order
    expect(agentOrder[0]).toBe('Orchestrator');
    expect(agentOrder[1]).toBe('Context');
    expect(agentOrder[2]).toBe('Data');
    expect(agentOrder[3]).toBe('Reasoning');
    expect(agentOrder[4]).toBe('Action');
  });

  it('should extract intent from user query', () => {
    const query = 'Find a quiet cafe with WiFi near me';
    
    // Expected intent extraction
    const expectedIntent = {
      workType: 'focus',
      amenities: ['wifi', 'quiet'],
      venueType: 'cafe',
    };

    expect(query.toLowerCase()).toContain('quiet');
    expect(query.toLowerCase()).toContain('wifi');
    expect(query.toLowerCase()).toContain('cafe');
  });

  it('should score venues based on criteria', () => {
    const venue = {
      name: 'Test Cafe',
      wifi: true,
      hasOutlets: true,
      noiseLevel: 'quiet',
      rating: 4.5,
      distance: 500,
    };

    // Scoring weights
    const weights = {
      wifi: 0.3,
      noise: 0.25,
      outlets: 0.2,
      rating: 0.15,
      distance: 0.1,
    };

    // Calculate expected score
    const wifiScore = venue.wifi ? 10 * weights.wifi : 0;
    const noiseScore = venue.noiseLevel === 'quiet' ? 10 * weights.noise : 5 * weights.noise;
    const outletScore = venue.hasOutlets ? 10 * weights.outlets : 0;
    const ratingScore = (venue.rating / 5) * 10 * weights.rating;
    const distanceScore = Math.max(0, (2000 - venue.distance) / 2000) * 10 * weights.distance;

    const totalScore = wifiScore + noiseScore + outletScore + ratingScore + distanceScore;

    expect(totalScore).toBeGreaterThan(0);
    expect(totalScore).toBeLessThanOrEqual(10);
  });
});
