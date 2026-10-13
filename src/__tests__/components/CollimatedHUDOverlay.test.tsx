// @ts-nocheck
import React from 'react';
import { render, screen } from '@testing-library/react';
import { CollimatedHUDOverlay } from '@/components/ar/CollimatedHUDOverlay';

describe('CollimatedHUDOverlay Component', () => {
  it('renders HUD overlay and initial status indicator', () => {
    render(<CollimatedHUDOverlay />);
    expect(screen.getByText(/HUD STATUS:/i)).toBeInTheDocument();
  });

  it('renders start session button when idle or unsupported', () => {
    render(<CollimatedHUDOverlay />);
    expect(screen.getByRole('button', { name: /Start WebXR HUD/i })).toBeInTheDocument();
  });
});