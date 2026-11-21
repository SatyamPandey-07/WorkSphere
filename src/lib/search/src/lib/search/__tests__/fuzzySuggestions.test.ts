import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import {
  damerauLevenshteinDistance,
  getFuzzyCategorySuggestion,
} from '../fuzzySuggestions';
import { VenueSearchInput } from '@/components/search/VenueSearchInput';

describe('fuzzySuggestions & VenueSearchInput', () => {
  it('suggests closest venue category for common mobile misspellings', () => {
    expect(getFuzzyCategorySuggestion('cwroking')).toBe('Coworking Space');
    expect(getFuzzyCategorySuggestion('libary')).toBe('Library');
    expect(getFuzzyCategorySuggestion('caf')).toBe('Cafe');
    expect(damerauLevenshteinDistance('cwroking', 'coworking')).toBeLessThanOrEqual(2);
  });

  it('shows Did you mean suggestion on zero results and executes search on click', () => {
    const onSelectSuggestion = jest.fn();
    const ref = React.createRef<HTMLInputElement>();

    render(
      <VenueSearchInput
        ref={ref}
        aria-label="Search venues"
        value="libary"
        hasZeroResults
        onChange={() => {}}
        onSelectSuggestion={onSelectSuggestion}
      />
    );

    const suggestionBtn = screen.getByRole('button', { name: /Library\?/i });
    fireEvent.click(suggestionBtn);

    expect(onSelectSuggestion).toHaveBeenCalledWith('Library');
  });
});