import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { MobileNavDrawer } from '@/components/navigation/MobileNavDrawer';

describe('MobileNavDrawer', () => {
  const items = [
    { id: 'explore', label: 'Explore', href: '/explore', active: true },
    { id: 'bookings', label: 'Bookings', href: '/bookings', active: false },
  ];

  it('centers the active route indicator bar inside the flex row', () => {
    render(<MobileNavDrawer isOpen items={items} onClose={jest.fn()} />);

    const activeLink = screen.getByTestId('mobile-nav-link-explore');
    const indicator = screen.getByTestId('mobile-nav-indicator-explore');

    expect(activeLink).toHaveAttribute('aria-current', 'page');
    expect(activeLink.className).toContain('items-center');
    expect(indicator.className).toContain('h-6');
    expect(indicator.className).toContain('w-1');
    expect(indicator.className).toContain('self-center');
    expect(screen.queryByTestId('mobile-nav-indicator-bookings')).toBeNull();
  });

  it('calls onClose when Escape is pressed', () => {
    const onClose = jest.fn();
    render(<MobileNavDrawer isOpen items={items} onClose={onClose} />);

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});