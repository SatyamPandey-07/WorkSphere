import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import RootLayout from '@/app/layout';

describe('SkipToContent & #main-content focus feedback', () => {
  it('moves focus to #main-content, exposes focus-visible ring styling, and announces navigation', async () => {
    render(
      <RootLayout>
        <p>Workspace dashboard body</p>
      </RootLayout>
    );

    const skipLink = screen.getByTestId('skip-to-content-link');
    const mainEl = screen.getByTestId('main-content');

    expect(mainEl.className).toContain('focus-visible:ring-2');
    expect(mainEl.className).not.toContain(' outline-none ');

    fireEvent.click(skipLink);
    expect(document.activeElement).toBe(mainEl);

    await waitFor(() => {
      expect(screen.getByTestId('skip-to-content-announcer').textContent).toBe(
        'Skipped to main content'
      );
    });
  });
});
