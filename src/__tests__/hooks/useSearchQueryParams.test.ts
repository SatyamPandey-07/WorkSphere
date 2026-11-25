import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import {
  parseSearchQuery,
  serializeSearchQuery,
  useSearchQueryParams,
} from '@/hooks/useSearchQueryParams';

function HookHarness() {
  const { queryString, queryParams, toggleAmenity } = useSearchQueryParams({
    q: 'Bandra',
  });

  return (
    <div>
      <span data-testid="query-string">{queryString}</span>
      <span data-testid="amenities-list">
        {(queryParams.amenities ?? []).join(',')}
      </span>
      <button type="button" onClick={() => toggleAmenity('wifi')}>
        Toggle WiFi
      </button>
      <button type="button" onClick={() => toggleAmenity('cafe')}>
        Toggle Cafe
      </button>
    </div>
  );
}

describe('useSearchQueryParams', () => {
  it('deduplicates repeated array keys and serializes comma-separated values', () => {
    const serialized = serializeSearchQuery({
      amenities: ['wifi', 'wifi', 'cafe', 'wifi'],
      q: '  quiet desk  ',
    });
    expect(serialized).toBe('q=quiet+desk&amenities=wifi%2Ccafe');

    const parsed = parseSearchQuery('?amenities=wifi&amenities=wifi&amenities=cafe');
    expect(parsed.amenities).toEqual(['wifi', 'cafe']);
  });

  it('toggles amenities cleanly without duplicate keys and responds to popstate', () => {
    render(<HookHarness />);

    fireEvent.click(screen.getByText('Toggle WiFi'));
    fireEvent.click(screen.getByText('Toggle WiFi'));
    fireEvent.click(screen.getByText('Toggle WiFi'));
    fireEvent.click(screen.getByText('Toggle Cafe'));

    expect(screen.getByTestId('amenities-list').textContent).toBe('wifi,cafe');
    expect(screen.getByTestId('query-string').textContent).not.toContain(
      'amenities=wifi&amenities=wifi'
    );

    act(() => {
      window.history.pushState(null, '', '/venues?q=Andheri&amenities=wifi');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });

    expect(screen.getByTestId('amenities-list').textContent).toBe('wifi');
  });
});
