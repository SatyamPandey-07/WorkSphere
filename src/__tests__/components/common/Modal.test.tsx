import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { Modal } from '@/components/common/Modal';

describe('Modal focus trap', () => {
  it('wraps Tab from last focusable element to first and Shift+Tab from first to last', () => {
    render(
      <div>
        <button type="button" data-testid="outside-btn">
          Outside
        </button>
        <Modal isOpen onClose={jest.fn()} title="Book Desk">
          <input type="text" data-testid="first-input" />
          <button type="button" data-testid="last-btn">
            Confirm
          </button>
        </Modal>
      </div>
    );

    const dialog = screen.getByTestId('modal-dialog');
    const closeBtn = screen.getByRole('button', { name: 'Close modal' });
    const lastBtn = screen.getByTestId('last-btn');

    lastBtn.focus();
    expect(document.activeElement).toBe(lastBtn);

    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(document.activeElement).toBe(closeBtn);

    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(lastBtn);
  });

  it('closes on Escape key press', () => {
    const onClose = jest.fn();
    render(
      <Modal isOpen onClose={onClose} title="Review">
        <button type="button">Submit</button>
      </Modal>
    );

    fireEvent.keyDown(screen.getByTestId('modal-dialog'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
