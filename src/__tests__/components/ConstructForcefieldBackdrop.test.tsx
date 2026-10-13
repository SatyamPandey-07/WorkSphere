// @ts-nocheck
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { ConstructForcefieldBackdrop } from '@/components/ui/ConstructForcefieldBackdrop';

describe('ConstructForcefieldBackdrop Component', () => {
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

  it('handles Escape key to trigger dismiss', () => {
    const handleDismiss = jest.fn();
    render(
      <ConstructForcefieldBackdrop isOpen={true} onDismiss={handleDismiss}>
        <div>Modal Content</div>
      </ConstructForcefieldBackdrop>
    );

    fireEvent.keyDown(window, { key: 'Escape', code: 'Escape' });
    expect(handleDismiss).toHaveBeenCalled();
  });
});