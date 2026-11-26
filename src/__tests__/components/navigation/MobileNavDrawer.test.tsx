import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { MobileNavDrawer } from '@/components/navigation/MobileNavDrawer';

describe('MobileNavDrawer active route indicator alignment', () => {
  it('renders a vertically centered rounded indicator bar on the active route item', () => {
    render(
      <MobileNavDrawer
        isOpen
        onClose={() => {}}
        items={[
          { id: 'home', label: 'Home', href: '/dashboard', active: true },
          { id: 'venues', label: 'Venues', href: '/venues', active: false },
        ]}
      />
    );

    const activeLink = screen.getByTestId('mobile-nav-link-home');
    const indicator = screen.getByTestId('mobile-nav-indicator-home');
    const inactiveLink = screen.getByTestId('mobile-nav-link-venues');

    expect(activeLink).toHaveAttribute('aria-current', 'page');
    expect(activeLink).toHaveClass('items-center');
    expect(indicator).toHaveClass('self-center', 'rounded-full', 'h-6', 'w-1');
    expect(inactiveLink).not.toHaveAttribute('aria-current');
    expect(screen.queryByTestId('mobile-nav-indicator-venues')).not.toBeInTheDocument();
  });

  it('calls onClose when close button is clicked', () => {
    const onClose = jest.fn();
    render(
      <MobileNavDrawer
        isOpen
        onClose={onClose}
        items={[{ id: 'home', label: 'Home', href: '/dashboard', active: true }]}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Close navigation drawer' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});