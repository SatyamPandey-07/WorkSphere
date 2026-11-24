import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { VenueSearchInput } from '@/components/search/VenueSearchInput';

describe('VenueSearchInput', () => {
  const originalPlatform = Object.getOwnPropertyDescriptor(navigator, 'platform');

  function setPlatform(value: string) {
    Object.defineProperty(navigator, 'platform', {
      value,
      configurable: true,
    });
  }

  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    if (originalPlatform) {
      Object.defineProperty(navigator, 'platform', originalPlatform);
    }
  });

  it('renders the desktop shortcut badge and uses the macOS label', () => {
    setPlatform('MacIntel');
    render(<VenueSearchInput />);

    expect(screen.getByTestId('search-shortcut-badge')).toHaveTextContent('⌘K');
  });

  it('uses the Windows/Linux shortcut label', () => {
    setPlatform('Win32');
    render(<VenueSearchInput />);

    expect(screen.getByTestId('search-shortcut-badge')).toHaveTextContent('Ctrl+K');
  });

  it('focuses, selects text, opens history, and prevents the default action', () => {
    setPlatform('Win32');
    window.localStorage.setItem(
      'worksphere:venue_search_history:v1',
      JSON.stringify(['quiet cafe'])
    );
    render(<VenueSearchInput value="quiet cafe" />);

    const input = screen.getByTestId('venue-search-input') as HTMLInputElement;
    const event = new KeyboardEvent('keydown', {
      key: 'k',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      window.dispatchEvent(event);
    });

    expect(document.activeElement).toBe(input);
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe('quiet cafe'.length);
    expect(screen.getByTestId('search-history-dropdown')).toBeInTheDocument();
    expect(event.defaultPrevented).toBe(true);
  });

  it('supports the macOS Meta+K shortcut', () => {
    setPlatform('MacIntel');
    render(<VenueSearchInput />);

    const input = screen.getByTestId('venue-search-input') as HTMLInputElement;
    fireEvent.keyDown(window, { key: 'k', metaKey: true });

    expect(document.activeElement).toBe(input);
  });

  it('does not trigger while typing in another input', () => {
    setPlatform('Win32');
    render(
      <>
        <input data-testid="other-input" />
        <VenueSearchInput />
      </>
    );

    const otherInput = screen.getByTestId('other-input');
    fireEvent.keyDown(otherInput, { key: 'k', ctrlKey: true });

    expect(document.activeElement).not.toBe(screen.getByTestId('venue-search-input'));
  });

  it('does not trigger inside contenteditable elements', () => {
    setPlatform('Win32');
    render(
      <>
        <div data-testid="editable" contentEditable />
        <VenueSearchInput />
      </>
    );

    fireEvent.keyDown(screen.getByTestId('editable'), { key: 'k', ctrlKey: true });

    expect(document.activeElement).not.toBe(screen.getByTestId('venue-search-input'));
  });

  it('does not trigger while typing in a textarea', () => {
    setPlatform('Win32');
    render(
      <>
        <textarea data-testid="other-textarea" />
        <VenueSearchInput />
      </>
    );

    fireEvent.keyDown(screen.getByTestId('other-textarea'), { key: 'k', ctrlKey: true });

    expect(document.activeElement).not.toBe(screen.getByTestId('venue-search-input'));
  });

  it('does not trigger while typing in a select', () => {
    setPlatform('Win32');
    render(
      <>
        <select data-testid="other-select"><option>One</option></select>
        <VenueSearchInput />
      </>
    );

    fireEvent.keyDown(screen.getByTestId('other-select'), { key: 'k', ctrlKey: true });

    expect(document.activeElement).not.toBe(screen.getByTestId('venue-search-input'));
  });

  it('hides the badge and does not register a listener when disabled', () => {
    setPlatform('Win32');
    const addSpy = jest.spyOn(window, 'addEventListener');
    render(<VenueSearchInput enableShortcut={false} />);

    expect(screen.queryByTestId('search-shortcut-badge')).not.toBeInTheDocument();
    expect(screen.getByTestId('venue-search-input')).not.toHaveAttribute('aria-keyshortcuts');
    expect(
      addSpy.mock.calls.filter(([type]) => type === 'keydown')
    ).toHaveLength(0);

    addSpy.mockRestore();
  });

  it('does not trigger the disabled shortcut', () => {
    setPlatform('Win32');
    render(<VenueSearchInput enableShortcut={false} />);

    const input = screen.getByTestId('venue-search-input') as HTMLInputElement;
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });

    expect(document.activeElement).not.toBe(input);
  });

  it.each([
    ['Ctrl+Shift+K', { key: 'k', ctrlKey: true, shiftKey: true }],
    ['Meta+Shift+K', { key: 'k', metaKey: true, shiftKey: true }],
    ['Ctrl+Alt+K', { key: 'k', ctrlKey: true, altKey: true }],
    ['Meta+Alt+K', { key: 'k', metaKey: true, altKey: true }],
    ['Ctrl+Meta+K', { key: 'k', ctrlKey: true, metaKey: true }],
  ])('ignores %s', (_label, keyboardEvent) => {
    setPlatform('Win32');
    render(<VenueSearchInput />);

    const input = screen.getByTestId('venue-search-input') as HTMLInputElement;
    fireEvent.keyDown(window, keyboardEvent);

    expect(document.activeElement).not.toBe(input);
  });

  it('cleans up its global listener on unmount', () => {
    const addSpy = jest.spyOn(window, 'addEventListener');
    const removeSpy = jest.spyOn(window, 'removeEventListener');
    const { unmount } = render(<VenueSearchInput />);

    const keydownAdd = addSpy.mock.calls.filter(([type]) => type === 'keydown');
    expect(keydownAdd).toHaveLength(1);

    unmount();

    expect(removeSpy).toHaveBeenCalledWith('keydown', expect.any(Function));
    addSpy.mockRestore();
    removeSpy.mockRestore();
  });

  it('does not register duplicate listeners across rerenders', () => {
    const addSpy = jest.spyOn(window, 'addEventListener');
    const removeSpy = jest.spyOn(window, 'removeEventListener');
    const { rerender } = render(<VenueSearchInput />);

    rerender(<VenueSearchInput placeholder="Updated" />);

    const keydownAdds = addSpy.mock.calls.filter(([type]) => type === 'keydown');
    expect(keydownAdds).toHaveLength(1);

    addSpy.mockRestore();
    removeSpy.mockRestore();
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
