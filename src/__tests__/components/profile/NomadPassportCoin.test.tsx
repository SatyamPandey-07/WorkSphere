import React from 'react';
import { render, fireEvent } from '@testing-library/react';
import { NomadPassportCoin } from '@/components/profile/NomadPassportCoin';

describe('NomadPassportCoin Component - Haptics & Interactions', () => {
  beforeEach(() => {
    Object.defineProperty(navigator, 'vibrate', {
      value: jest.fn().mockReturnValue(true),
      configurable: true,
      writable: true
    });
  });

  test('should trigger light haptic pulse on card flip', () => {
    const { getByText } = render(
      <NomadPassportCoin passportId="PASS-998877" nomadName="Soham Gonbhare" countryCode="IND" stampsCount={12} />
    );
    const card = getByText('Digital Nomad Passport').closest('div');
    fireEvent.click(card!);
    expect(navigator.vibrate).toHaveBeenCalledWith(15);
  });

  test('should trigger double-tap haptic pattern on stamp reveal', () => {
    const { getByText } = render(
      <NomadPassportCoin passportId="PASS-998877" nomadName="Soham Gonbhare" countryCode="IND" stampsCount={12} />
    );
    const card = getByText('Digital Nomad Passport').closest('div');
    fireEvent.click(card!);
    const stampButton = getByText('Click to Verify Stamp');
    fireEvent.click(stampButton);
    expect(navigator.vibrate).toHaveBeenCalledWith([10, 30, 10]);
  });
});
