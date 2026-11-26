import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { SearchBar } from '../SearchBar';

describe('SearchBar keyboard shortcut badge & focus', () => {
  const originalPlatform = Object.getOwnPropertyDescriptor(navigator, 'platform');

  function setPlatform(value: string) {
    Object.defineProperty(navigator, 'platform', {
      value,
      configurable: true,
    });
  }

  afterEach(() => {
    if (originalPlatform) {
      Object.defineProperty(navigator, 'platform', originalPlatform);
    }
  });

  it('renders Ctrl+K on non-macOS and focuses input on Ctrl+K', () => {
    setPlatform('Win32');
    render(<SearchBar />);

    const badge = screen.getByTestId('search-shortcut-badge');
    expect(badge).toHaveTextContent('Ctrl+K');

    const input = screen.getByLabelText('Search venues') as HTMLInputElement;
    expect(document.activeElement).not.toBe(input);

    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    expect(document.activeElement).toBe(input);
  });

  it('renders ⌘K on macOS and focuses input on Meta+K', () => {
    setPlatform('MacIntel');
    render(<SearchBar />);

    const badge = screen.getByTestId('search-shortcut-badge');
    expect(badge).toHaveTextContent('⌘K');

    const input = screen.getByLabelText('Search venues') as HTMLInputElement;
    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    expect(document.activeElement).toBe(input);
  });

  it('forwards enableShortcut=false and hides the shortcut badge', () => {
    setPlatform('Win32');
    render(<SearchBar enableShortcut={false} />);

    expect(screen.queryByTestId('search-shortcut-badge')).not.toBeInTheDocument();

    const input = screen.getByLabelText('Search venues') as HTMLInputElement;
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    expect(document.activeElement).not.toBe(input);
  });
});