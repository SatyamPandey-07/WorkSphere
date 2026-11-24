import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { VenueFilterBar } from '@/components/venues/VenueFilterBar';

describe('VenueFilterBar', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('toggles amenity chips, updates aria-pressed, and preserves existing query params', () => {
    const onQueryParamsChange = jest.fn();
    render(
      <VenueFilterBar
        existingSearchParams="q=Bandra&sort=rating"
        onQueryParamsChange={onQueryParamsChange}
      />
    );

    const petChip = screen.getByTestId('venue-filter-chip-dogFriendly');
    expect(petChip).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(petChip);
    expect(petChip).toHaveAttribute('aria-pressed', 'true');
    expect(onQueryParamsChange).toHaveBeenCalledWith(
      'q=Bandra&sort=rating&amenities=dogFriendly&dogFriendly=true'
    );

    act(() => {
      jest.advanceTimersByTime(250);
    });

    expect(screen.getByTestId('venue-filter-live-region').textContent).toBe(
      '1 amenity filter active.'
    );
  });

  it('renders standing desks and external monitors filter chips (#9759)', () => {
    const onQueryParamsChange = jest.fn();
    render(
      <VenueFilterBar
        existingSearchParams="q=Pune"
        onQueryParamsChange={onQueryParamsChange}
      />
    );

    const standingDeskChip = screen.getByTestId('venue-filter-chip-standing_desks');
    expect(standingDeskChip).toBeInTheDocument();
    expect(standingDeskChip).toHaveTextContent('Standing Desk');
    expect(standingDeskChip).toHaveAttribute('aria-pressed', 'false');

    const monitorChip = screen.getByTestId('venue-filter-chip-external_monitors');
    expect(monitorChip).toBeInTheDocument();
    expect(monitorChip).toHaveTextContent('External Monitor (4K/USB-C)');
    expect(monitorChip).toHaveAttribute('aria-pressed', 'false');

    // Toggle standing desks
    fireEvent.click(standingDeskChip);
    expect(standingDeskChip).toHaveAttribute('aria-pressed', 'true');
    expect(onQueryParamsChange).toHaveBeenCalledWith(
      'q=Pune&amenities=standing_desks&standing_desks=true'
    );

    // Toggle external monitors
    fireEvent.click(monitorChip);
    expect(monitorChip).toHaveAttribute('aria-pressed', 'true');
    expect(onQueryParamsChange).toHaveBeenCalledWith(
      'q=Pune&amenities=standing_desks%2Cexternal_monitors&standing_desks=true&external_monitors=true'
    );
  });

  it('renders and toggles vegan options and pet friendly amenity chips with keyboard support (#9882)', () => {
    const onQueryParamsChange = jest.fn();
    render(
      <VenueFilterBar
        existingSearchParams="q=Goa"
        onQueryParamsChange={onQueryParamsChange}
      />
    );

    const veganChip = screen.getByTestId('venue-filter-chip-veganOptions');
    expect(veganChip).toBeInTheDocument();
    expect(veganChip).toHaveTextContent('Vegan Options');
    expect(veganChip).toHaveAttribute('aria-pressed', 'false');

    const petChip = screen.getByTestId('venue-filter-chip-dogFriendly');
    expect(petChip).toBeInTheDocument();
    expect(petChip).toHaveTextContent('Pet Friendly');
    expect(petChip).toHaveAttribute('aria-pressed', 'false');

    // Toggle Vegan Options with Space key
    fireEvent.keyDown(veganChip, { key: ' ' });
    expect(veganChip).toHaveAttribute('aria-pressed', 'true');
    expect(onQueryParamsChange).toHaveBeenCalledWith(
      'q=Goa&amenities=veganOptions&veganOptions=true'
    );

    // Toggle Pet Friendly with Enter key
    fireEvent.keyDown(petChip, { key: 'Enter' });
    expect(petChip).toHaveAttribute('aria-pressed', 'true');
    expect(onQueryParamsChange).toHaveBeenCalledWith(
      'q=Goa&amenities=veganOptions%2CdogFriendly&dogFriendly=true&veganOptions=true'
    );
  });
});
