import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import {
  VENUE_SEARCH_HISTORY_STORAGE_KEY,
  VenueSearchInput,
} from '@/components/search/VenueSearchInput';

describe('VenueSearchInput query normalization, deduplication, and Clear all', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('does not render Clear all when search history is empty', () => {
    render(<VenueSearchInput />);
    const input = screen.getByTestId('venue-search-input');
    fireEvent.focus(input);

    expect(screen.queryByTestId('clear-all-history-btn')).not.toBeInTheDocument();
    expect(screen.queryByTestId('search-history-dropdown')).not.toBeInTheDocument();
  });

  it('ignores whitespace-only queries and deduplicates case-insensitively with normalized spacing', () => {
    render(<VenueSearchInput />);
    const input = screen.getByTestId('venue-search-input');

    fireEvent.change(input, { target: { value: '    ' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    fireEvent.change(input, { target: { value: ' coffee' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    fireEvent.change(input, { target: { value: '  COFFEE   house ' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    fireEvent.change(input, { target: { value: 'coffee ' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    const stored = JSON.parse(
      window.localStorage.getItem(VENUE_SEARCH_HISTORY_STORAGE_KEY) ?? '[]'
    );
    expect(stored).toEqual(['coffee', 'COFFEE house']);

    fireEvent.focus(input);
    const items = screen.getAllByRole('button').filter(
      (btn) => btn.getAttribute('data-testid') !== 'clear-all-history-btn'
    );
    expect(items.map((el) => el.textContent)).toEqual(['coffee', 'COFFEE house']);
  });

  it('clears localStorage, closes/resets dropdown, and announces via aria-live when Clear all is clicked', () => {
    window.localStorage.setItem(
      VENUE_SEARCH_HISTORY_STORAGE_KEY,
      JSON.stringify(['Bhandup West cafes', 'Quiet coworking Mumbai'])
    );

    render(<VenueSearchInput />);
    const input = screen.getByTestId('venue-search-input');
    fireEvent.focus(input);

    expect(screen.getByTestId('search-history-dropdown')).toBeInTheDocument();
    const clearAllBtn = screen.getByTestId('clear-all-history-btn');
    expect(clearAllBtn).toBeInTheDocument();

    fireEvent.click(clearAllBtn);

    expect(window.localStorage.getItem(VENUE_SEARCH_HISTORY_STORAGE_KEY)).toBe('[]');
    expect(screen.queryByTestId('search-history-dropdown')).not.toBeInTheDocument();
    expect(screen.queryByTestId('clear-all-history-btn')).not.toBeInTheDocument();
    expect(screen.getByTestId('search-history-live-region')).toHaveTextContent(
      'Search history cleared.'
    );
  });
});