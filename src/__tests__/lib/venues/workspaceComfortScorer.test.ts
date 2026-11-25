import { evaluateWorkspaceComfort } from '@/lib/venues/workspaceComfortScorer';

describe('Workspace Comfort & Ergonomics Scorer', () => {
  it('weights pillars differently across deep_work, client_calls, and balanced modes', () => {
    const baseInput = {
      venueId: 'hub-1',
      noiseDb: 42,
      outletsPerSeat: 1.5,
      hasBackupPower: true,
      ergonomicsRating: 4.5,
      lightingRating: 4.5,
      downloadMbps: 35,
      latencyMs: 110,
    };

    const deepWork = evaluateWorkspaceComfort({
      ...baseInput,
      mode: 'deep_work',
    });
    const clientCalls = evaluateWorkspaceComfort({
      ...baseInput,
      mode: 'client_calls',
    });

    expect(deepWork.overallScore).toBeGreaterThan(clientCalls.overallScore);
    expect(deepWork.strengths.length).toBeGreaterThan(0);
  });

  it('handles missing, negative, or non-finite values safely without NaN and clamps to [0, 100]', () => {
    const missingResult = evaluateWorkspaceComfort({
      venueId: 'hub-missing',
      noiseDb: Number.NaN,
      outletsPerSeat: undefined,
      hasBackupPower: null,
      ergonomicsRating: Number.POSITIVE_INFINITY,
      lightingRating: -5,
      downloadMbps: Number.NaN,
      latencyMs: Number.NaN,
    });

    expect(Number.isNaN(missingResult.overallScore)).toBe(false);
    expect(missingResult.overallScore).toBeGreaterThanOrEqual(0);
    expect(missingResult.overallScore).toBeLessThanOrEqual(100);

    const loudNoisy = evaluateWorkspaceComfort({
      venueId: 'hub-noisy',
      noiseDb: 140,
      outletsPerSeat: 0,
      hasBackupPower: false,
      ergonomicsRating: 0,
      lightingRating: 0,
      downloadMbps: 0,
      latencyMs: 500,
      mode: 'deep_work',
    });

    expect(loudNoisy.overallScore).toBeGreaterThanOrEqual(0);
    expect(loudNoisy.overallScore).toBeLessThanOrEqual(100);
    expect(loudNoisy.caveats.length).toBeGreaterThanOrEqual(3);
  });

  it('produces deterministic score breakdowns for identical inputs', () => {
    const input = {
      venueId: 'hub-det',
      noiseDb: 48,
      outletsPerSeat: 1.2,
      hasBackupPower: true,
      ergonomicsRating: 4,
      lightingRating: 4,
      downloadMbps: 140,
      latencyMs: 18,
      mode: 'balanced' as const,
    };

    expect(evaluateWorkspaceComfort(input)).toEqual(
      evaluateWorkspaceComfort(input)
    );
  });
});
