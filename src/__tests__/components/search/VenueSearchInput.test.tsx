import React, { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { VenueSearchInput } from '@/components/search/VenueSearchInput';

describe('VenueSearchInput Escape & aria-expanded sync', () => {
  it('closes dropdown on Escape and keeps aria-expanded synced on blur and re-focus', () => {
    const Harness = () => {
      const [query, setQuery] = useState('');
      return (
        <div>
          <VenueSearchInput
            value={query}
            onChange={setQuery}
            historyItems={['Bandra West', 'Powai Hub']}
          />
          <button type="button" data-testid="after-input-btn">
            Next Focusable
          </button>
        </div>
      );
    };

    render(<Harness />);
    const input = screen.getByTestId('venue-search-input');

    fireEvent.focus(input);
    expect(input.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByTestId('venue-search-history-dropdown')).toBeTruthy();

    fireEvent.keyDown(input, { key: 'Escape', code: 'Escape' });
    expect(input.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByTestId('venue-search-history-dropdown')).toBeNull();

    fireEvent.blur(input, {
      relatedTarget: screen.getByTestId('after-input-btn'),
    });
    expect(input.getAttribute('aria-expanded')).toBe('false');

    fireEvent.focus(input);
    expect(input.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByTestId('venue-search-history-dropdown')).toBeTruthy();
  });
});
