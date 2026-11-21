import React, { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { ModalOverlay } from '../ModalOverlay';

function TestHost() {
  const [open, setOpen] = useState(false);

  return (
    <div>
      <button
        type="button"
        data-testid="trigger-btn"
        onClick={() => setOpen(true)}
      >
        Open Dialog
      </button>

      <ModalOverlay
        isOpen={open}
        onClose={() => setOpen(false)}
        title="Quick Action Modal"
      >
        <p>Overlay content</p>
        <button type="button" data-testid="inside-btn">
          Confirm
        </button>
      </ModalOverlay>
    </div>
  );
}

describe('useModalFocusTrap & ModalOverlay', () => {
  it('closes on Escape, ignores unrelated keys, and restores focus to trigger', () => {
    render(<TestHost />);

    const trigger = screen.getByTestId('trigger-btn');
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    fireEvent.click(trigger);
    expect(screen.getByRole('dialog', { name: 'Quick Action Modal' })).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Enter' });
    fireEvent.keyDown(document, { key: 'a' });
    expect(screen.getByRole('dialog', { name: 'Quick Action Modal' })).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Quick Action Modal' })).not.toBeInTheDocument();
    expect(document.activeElement).toBe(trigger);
  });
});