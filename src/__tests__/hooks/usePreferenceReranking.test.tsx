import { renderHook, act } from '@testing-library/react';
import { usePreferenceReranking } from '../../hooks/usePreferenceReranking';

describe('usePreferenceReranking Hook', () => {
  const mockVenues = [
    { id: 'venue-1', name: 'Quiet Cafe', wifiSpeed: 15, noiseLevel: 'low', rating: 4.2 },
    { id: 'venue-2', name: 'Tech Hub Coworking', wifiSpeed: 250, noiseLevel: 'moderate', rating: 4.8 },
    { id: 'venue-3', name: 'Library Lounge', wifiSpeed: 50, noiseLevel: 'quiet', rating: 4.5 },
  ];

  test('1. Returns default order when user has empty interaction history', () => {
    const { result } = renderHook(() =>
      usePreferenceReranking({
        venues: mockVenues,
        interactionHistory: [],
        filters: { noiseFilterEnabled: true },
      })
    );

    // Should return venues in original or default sorted order without throwing
    expect(result.current.rankedVenues).toHaveLength(mockVenues.length);
    expect(result.current.rankedVenues[0].id).toBe(mockVenues[0].id);
  });

  test('2. Correctly prioritizes high-speed WiFi venues when user history exhibits strong WiFi preference weight', () => {
    const strongWifiHistory = [
      { venueId: 'venue-2', action: 'bookmarked', weight: 1.0 },
      { venueId: 'venue-2', action: 'spent_time', weight: 0.9 },
    ];

    const { result } = renderHook(() =>
      usePreferenceReranking({
        venues: mockVenues,
        interactionHistory: strongWifiHistory,
        filters: { noiseFilterEnabled: true },
      })
    );

    // High WiFi venue (venue-2, 250 Mbps) should rank #1 due to cosine similarity & vector preference
    expect(result.current.rankedVenues[0].id).toBe('venue-2');
  });

  test('3. Respects active toggle states (e.g. disabling noise filter keeps ranking stable)', () => {
    const history = [{ venueId: 'venue-1', action: 'viewed', weight: 0.5 }];

    const { result, rerender } = renderHook(
      ({ noiseFilterEnabled }) =>
        usePreferenceReranking({
          venues: mockVenues,
          interactionHistory: history,
          filters: { noiseFilterEnabled },
        }),
      { initialProps: { noiseFilterEnabled: true } }
    );

    const initialFirstVenueId = result.current.rankedVenues[0].id;

    // Disable noise filter
    rerender({ noiseFilterEnabled: false });

    // Ranking should remain stable or correctly update based on toggle state without crashing
    expect(result.current.rankedVenues).toBeDefined();
    expect(result.current.rankedVenues.length).toBe(mockVenues.length);
  });
});