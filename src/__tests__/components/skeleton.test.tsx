import { render } from '@testing-library/react';
import '@testing-library/jest-dom';
import { VenueCardSkeleton, ChatMessageSkeleton } from '@/components/ui/skeleton';

describe('Skeleton Components', () => {
  describe('VenueCardSkeleton', () => {
    it('renders skeleton elements', () => {
      const { container } = render(<VenueCardSkeleton />);
      expect(container.querySelector('.animate-pulse')).toBeInTheDocument();
    });

    it('has proper structure', () => {
      const { container } = render(<VenueCardSkeleton />);
      expect(container.firstChild).toBeInTheDocument();
    });
  });

  describe('ChatMessageSkeleton', () => {
    it('renders skeleton for chat messages', () => {
      const { container } = render(<ChatMessageSkeleton />);
      expect(container.querySelector('.animate-pulse')).toBeInTheDocument();
    });

    it('renders skeleton structure', () => {
      const { container } = render(<ChatMessageSkeleton />);
      expect(container.firstChild).toBeInTheDocument();
    });
  });
});
