import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import {
  VENUE_SEARCH_HISTORY_STORAGE_KEY,
  VenueSearchInput,
} from '@/components/search/VenueSearchInput';

describe('VenueSearchInput Clear all history action', () => {
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