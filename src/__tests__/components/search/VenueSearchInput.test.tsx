import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { VenueSearchInput } from '@/components/search/VenueSearchInput';

describe('VenueSearchInput', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('submits search query with active amenities and handles storage errors gracefully', () => {
    const onQueryParamsChange = jest.fn();
    const setItemSpy = jest
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new Error('QuotaExceededError');
      });

    render(
      <VenueSearchInput
        existingSearchParams="sort=rating"
        activeAmenities={['outdoorPatio']}
        onQueryParamsChange={onQueryParamsChange}
      />
    );

    const input = screen.getByTestId('venue-search-input');
    fireEvent.change(input, { target: { value: '  quiet cafe  ' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onQueryParamsChange).toHaveBeenCalledWith(
      'sort=rating&q=quiet+cafe&amenities=outdoorPatio'
    );
    setItemSpy.mockRestore();
  });
});
