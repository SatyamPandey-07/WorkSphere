import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { RoutingOptimizer } from '../../components/map/RoutingOptimizer';

describe('RoutingOptimizer Component - Mode Switching & Keyboard Navigation', () => {
  const mockOnModeChange = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('1. Renders Walk, Bike, and Drive buttons with correct initial active state', () => {
    render(<RoutingOptimizer activeMode="walk" onModeChange={mockOnModeChange} isLoading={false} />);

    const walkBtn = screen.getByRole('button', { name: /walk/i });
    const bikeBtn = screen.getByRole('button', { name: /bike/i });
    const driveBtn = screen.getByRole('button', { name: /drive/i });

    expect(walkBtn).toBeInTheDocument();
    expect(bikeBtn).toBeInTheDocument();
    expect(driveBtn).toBeInTheDocument();

    // Verify initial active state (e.g., active class or aria-pressed)
    expect(walkBtn).toHaveAttribute('aria-pressed', 'true');
    expect(bikeBtn).toHaveAttribute('aria-pressed', 'false');
    expect(driveBtn).toHaveAttribute('aria-pressed', 'false');
  });

  test('2. Clicking a mode triggers the onModeChange callback with expected payload', () => {
    render(<RoutingOptimizer activeMode="walk" onModeChange={mockOnModeChange} isLoading={false} />);

    const bikeBtn = screen.getByRole('button', { name: /bike/i });
    fireEvent.click(bikeBtn);

    expect(mockOnModeChange).toHaveBeenCalledTimes(1);
    expect(mockOnModeChange).toHaveBeenCalledWith('bike');
  });

  test('3. Keyboard navigation (Enter and Space) activates mode selection', () => {
    render(<RoutingOptimizer activeMode="walk" onModeChange={mockOnModeChange} isLoading={false} />);

    const driveBtn = screen.getByRole('button', { name: /drive/i });

    // Test Enter key
    fireEvent.keyDown(driveBtn, { key: 'Enter', code: 'Enter', charCode: 13 });
    expect(mockOnModeChange).toHaveBeenCalledWith('drive');

    // Test Space key
    fireEvent.keyDown(driveBtn, { key: ' ', code: 'Space', charCode: 32 });
    expect(mockOnModeChange).toHaveBeenCalledWith('drive');
  });

  test('4. Disables mode selection while route computation is loading', () => {
    render(<RoutingOptimizer activeMode="walk" onModeChange={mockOnModeChange} isLoading={true} />);

    const walkBtn = screen.getByRole('button', { name: /walk/i });
    const bikeBtn = screen.getByRole('button', { name: /bike/i });
    const driveBtn = screen.getByRole('button', { name: /drive/i });

    expect(walkBtn).toBeDisabled();
    expect(bikeBtn).toBeDisabled();
    expect(driveBtn).toBeDisabled();

    // Clicking should not trigger callback when loading
    fireEvent.click(bikeBtn);
    expect(mockOnModeChange).not.toHaveBeenCalled();
  });
});
