import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { RatingDialog } from '@/components/venues/RatingDialog';

describe('RatingDialog accessibility & arrow navigation', () => {
  it('exposes explicit aria-label and aria-pressed state on each star button', () => {
    const onSelectRating = jest.fn();

    render(
      <RatingDialog
        isOpen
        venueName="Bhandup Work Hub"
        onSelectRating={onSelectRating}
        onClose={() => {}}
      />
    );

    const star1 = screen.getByRole('button', { name: 'Rate 1 out of 5 stars' });
    const star3 = screen.getByRole('button', { name: 'Rate 3 out of 5 stars' });
    const star5 = screen.getByRole('button', { name: 'Rate 5 out of 5 stars' });

    expect(star1).toHaveAttribute('aria-pressed', 'false');
    expect(star3).toHaveAttribute('aria-pressed', 'false');
    expect(star5).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(star3);
    expect(star3).toHaveAttribute('aria-pressed', 'true');
    expect(star1).toHaveAttribute('aria-pressed', 'false');
    expect(onSelectRating).toHaveBeenCalledWith(3);
  });

  it('increments and decrements rating using arrow keys', () => {
    const onSelectRating = jest.fn();

    render(
      <RatingDialog
        isOpen
        venueName="Quiet Cafe"
        initialRating={2}
        onSelectRating={onSelectRating}
        onClose={() => {}}
      />
    );

    const star2 = screen.getByRole('button', { name: 'Rate 2 out of 5 stars' });
    star2.focus();

    fireEvent.keyDown(star2, { key: 'ArrowRight' });
    expect(onSelectRating).toHaveBeenLastCalledWith(3);
    expect(screen.getByRole('button', { name: 'Rate 3 out of 5 stars' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );

    const star3 = screen.getByRole('button', { name: 'Rate 3 out of 5 stars' });
    fireEvent.keyDown(star3, { key: 'ArrowLeft' });
    expect(onSelectRating).toHaveBeenLastCalledWith(2);
    expect(star2).toHaveAttribute('aria-pressed', 'true');
  });
});