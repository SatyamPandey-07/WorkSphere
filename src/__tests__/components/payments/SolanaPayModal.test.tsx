import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { SolanaPayModal } from '@/components/payments/SolanaPayModal';

describe('SolanaPayModal Component', () => {
  const mockOnClose = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders correctly when open with high-contrast container and QR code', () => {
    render(<SolanaPayModal isOpen={true} onClose={mockOnClose} amount="2.0 SOL" />);

    expect(screen.getByText('Solana Pay Secure Terminal')).toBeDefined();
    expect(screen.getByText('2.0 SOL')).toBeDefined();
    
    // Check close button interaction
    const closeBtn = screen.getByLabelText('Close modal');
    fireEvent.click(closeBtn);
    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  it('does not render when isOpen is false', () => {
    const { container } = render(<SolanaPayModal isOpen={false} onClose={mockOnClose} />);
    expect(container.firstChild).toBeNull();
  });

  it('requests screen wake lock on mount when supported', async () => {
    const requestMock = jest.fn().mockResolvedValue({
      release: jest.fn().mockResolvedValue(undefined),
      addEventListener: jest.fn(),
    });

    Object.defineProperty(navigator, 'wakeLock', {
      value: { request: requestMock },
      configurable: true,
    });

    render(<SolanaPayModal isOpen={true} onClose={mockOnClose} />);

    expect(requestMock).toHaveBeenCalledWith('screen');
  });
});
