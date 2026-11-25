import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Navbar } from '@/components/layout/Navbar';
import { DraftStore } from '@/worker/bookingSync/DraftStore';

describe('Navbar offline booking drafts badge & sync retry popover (#10301)', () => {
  let originalOnLine: boolean;

  beforeEach(() => {
    originalOnLine = navigator.onLine;
    Object.defineProperty(navigator, 'onLine', {
      writable: true,
      configurable: true,
      value: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(navigator, 'onLine', {
      writable: true,
      configurable: true,
      value: originalOnLine,
    });
  });

  it('displays pending offline draft count and opens popover on badge click', async () => {
    const store = new DraftStore('test_db_popover_1');
    const onOpenDrafts = jest.fn();

    render(<Navbar draftStore={store} onOpenDrafts={onOpenDrafts} />);
    expect(screen.queryByTestId('offline-drafts-badge')).toBeNull();

    await act(async () => {
      await store.saveDraft({
        id: 'd1',
        venueId: 'v1',
        venueName: 'Bandra Hub',
        dateISO: '2026-11-26',
      });
      await store.saveDraft({
        id: 'd2',
        venueId: 'v2',
        venueName: 'Powai Loft',
        dateISO: '2026-11-27',
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId('offline-drafts-badge').textContent).toContain('2 Offline Drafts');
    });

    // Popover is initially closed
    expect(screen.queryByTestId('offline-drafts-popover')).toBeNull();

    // Click badge opens popover
    fireEvent.click(screen.getByTestId('offline-drafts-badge'));
    expect(onOpenDrafts).toHaveBeenCalledTimes(1);

    const popover = screen.getByTestId('offline-drafts-popover');
    expect(popover).toBeInTheDocument();
    expect(screen.getByTestId('pending-drafts-count').textContent).toContain('2 drafts waiting to sync');

    // Shows drafts
    await waitFor(() => {
      expect(screen.getByText('Bandra Hub')).toBeInTheDocument();
      expect(screen.getByText('Powai Loft')).toBeInTheDocument();
    });

    // "Sync Now" button is present and enabled when online
    const syncBtn = screen.getByTestId('sync-now-button');
    expect(syncBtn).toBeInTheDocument();
    expect(syncBtn).not.toBeDisabled();
    expect(screen.queryByTestId('offline-indicator')).toBeNull();
  });

  it('triggers synchronization when clicking "Sync Now"', async () => {
    const store = new DraftStore('test_db_popover_2');
    const onSyncTriggered = jest.fn().mockImplementation(async () => {
      await store.markSynced('d1');
      await store.markSynced('d2');
    });

    render(<Navbar draftStore={store} onSyncTriggered={onSyncTriggered} />);

    await act(async () => {
      await store.saveDraft({
        id: 'd1',
        venueId: 'v1',
        venueName: 'Bandra Hub',
        dateISO: '2026-11-26',
      });
      await store.saveDraft({
        id: 'd2',
        venueId: 'v2',
        venueName: 'Powai Loft',
        dateISO: '2026-11-27',
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId('offline-drafts-badge')).toBeInTheDocument();
    });

    // Open popover
    fireEvent.click(screen.getByTestId('offline-drafts-badge'));

    const syncBtn = screen.getByTestId('sync-now-button');
    await act(async () => {
      fireEvent.click(syncBtn);
    });

    expect(onSyncTriggered).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(screen.queryByTestId('offline-drafts-badge')).toBeNull();
    });
  });

  it('disables "Sync Now" and displays offline indicator when browser is offline, and recovers when online', async () => {
    Object.defineProperty(navigator, 'onLine', {
      writable: true,
      configurable: true,
      value: false,
    });

    const store = new DraftStore('test_db_popover_3');
    const onSyncTriggered = jest.fn();

    render(<Navbar draftStore={store} onSyncTriggered={onSyncTriggered} />);

    await act(async () => {
      await store.saveDraft({
        id: 'd1',
        venueId: 'v1',
        venueName: 'Bandra Hub',
        dateISO: '2026-11-26',
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId('offline-drafts-badge')).toBeInTheDocument();
    });

    // Open popover
    fireEvent.click(screen.getByTestId('offline-drafts-badge'));

    // Verify offline indicator is shown
    expect(screen.getByTestId('offline-indicator')).toBeInTheDocument();
    expect(screen.getByTestId('offline-indicator').textContent).toContain('Offline');

    // Verify "Sync Now" button is disabled
    const syncBtn = screen.getByTestId('sync-now-button');
    expect(syncBtn).toBeDisabled();

    // Clicking disabled button should not trigger sync
    fireEvent.click(syncBtn);
    expect(onSyncTriggered).not.toHaveBeenCalled();

    // Transition back to online
    await act(async () => {
      Object.defineProperty(navigator, 'onLine', {
        writable: true,
        configurable: true,
        value: true,
      });
      window.dispatchEvent(new Event('online'));
    });

    // Indicator disappears and button becomes enabled
    expect(screen.queryByTestId('offline-indicator')).toBeNull();
    expect(screen.getByTestId('sync-now-button')).not.toBeDisabled();
  });
});
