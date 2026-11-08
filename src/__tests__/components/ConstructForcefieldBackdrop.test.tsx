import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { ConstructForcefieldBackdrop } from '@/components/ui/ConstructForcefieldBackdrop';

describe('ConstructForcefieldBackdrop Component', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('renders modal backdrop with proper ARIA dialog semantics', () => {
    render(
      <ConstructForcefieldBackdrop isOpen={true} onDismiss={jest.fn()}>
        <div>Modal Body</div>
      </ConstructForcefieldBackdrop>
    );

    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByText('Modal Body')).toBeInTheDocument();
  });

  it('returns null when isOpen is false', () => {
    const { container } = render(
      <ConstructForcefieldBackdrop isOpen={false} onDismiss={jest.fn()}>
        <div>Modal Body</div>
      </ConstructForcefieldBackdrop>
    );
    expect(container.firstChild).toBeNull();
  });

  it('handles Escape key to trigger dismiss', () => {
    const handleDismiss = jest.fn();
    render(
      <ConstructForcefieldBackdrop isOpen={true} onDismiss={handleDismiss}>
        <div>Modal Content</div>
      </ConstructForcefieldBackdrop>
    );

    fireEvent.keyDown(window, { key: 'Escape', code: 'Escape' });
    expect(handleDismiss).toHaveBeenCalledTimes(1);
  });

  it('triggers ripple shockwave on backdrop click and dismisses after 450ms', () => {
    const handleDismiss = jest.fn();
    render(
      <ConstructForcefieldBackdrop isOpen={true} onDismiss={handleDismiss}>
        <div>Content</div>
      </ConstructForcefieldBackdrop>
    );

    const backdrop = screen.getByRole('dialog');
    fireEvent.click(backdrop, { clientX: 100, clientY: 150 });

    expect(screen.getByTestId('forcefield-ripple')).toBeInTheDocument();
    expect(handleDismiss).not.toHaveBeenCalled();

    act(() => {
      jest.advanceTimersByTime(450);
    });

    expect(handleDismiss).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('forcefield-ripple')).not.toBeInTheDocument();
  });

  it('prevents backdrop click from triggering when clicking inside modal content', () => {
    const handleDismiss = jest.fn();
    render(
      <ConstructForcefieldBackdrop isOpen={true} onDismiss={handleDismiss}>
        <button>Inside Modal</button>
      </ConstructForcefieldBackdrop>
    );

    fireEvent.click(screen.getByRole('button', { name: /Inside Modal/i }));

    act(() => {
      jest.advanceTimersByTime(500);
    });

    expect(handleDismiss).not.toHaveBeenCalled();
    expect(screen.queryByTestId('forcefield-ripple')).not.toBeInTheDocument();
  });

  it('cleans up pending timer on unmount without invoking onDismiss', () => {
    const handleDismiss = jest.fn();
    const { unmount } = render(
      <ConstructForcefieldBackdrop isOpen={true} onDismiss={handleDismiss}>
        <div>Modal Content</div>
      </ConstructForcefieldBackdrop>
    );

    fireEvent.click(screen.getByRole('dialog'));
    unmount();

    act(() => {
      jest.advanceTimersByTime(500);
    });

    expect(handleDismiss).not.toHaveBeenCalled();
  });
});
