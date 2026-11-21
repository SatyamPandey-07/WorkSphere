import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { SoundLevelMeter } from '../SoundLevelMeter';
import { VenueAcousticCard } from '@/components/venue/VenueAcousticCard';

describe('SoundLevelMeter & VenueAcousticCard accessibility', () => {
  it('renders explicit screen-reader text and tier label for quiet levels', () => {
    render(<VenueAcousticCard venueName="Bhandup Quiet Hub" decibels={42} />);

    expect(screen.getByText('Quiet: 42dB')).toBeInTheDocument();
    expect(screen.getByTestId('acoustic-tier-label')).toHaveTextContent('Quiet: 42dB');
  });

  it('toggles high-contrast mode and respects prefers-contrast: more', () => {
    const matchMediaMock = jest.fn().mockImplementation((query: string) => ({
      matches: query === '(prefers-contrast: more)',
      media: query,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      addListener: jest.fn(),
      removeListener: jest.fn(),
    }));
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: matchMediaMock,
    });

    render(<SoundLevelMeter decibels={76} showToggle onToggleHighContrast={() => {}} />);

    const meter = screen.getByTestId('sound-level-meter');
    expect(meter).toHaveAttribute('data-tier', 'LOUD');
    expect(meter).toHaveAttribute('data-high-contrast', 'true');
    expect(screen.getAllByText('Loud: 76dB').length).toBeGreaterThan(0);

    const card = render(<VenueAcousticCard venueName="Busy Cafe" decibels={60} />);
    const toggle = card.getByTestId('high-contrast-toggle');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
  });
});