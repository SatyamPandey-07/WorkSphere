import React from 'react';
import { render, screen, fireEvent, renderHook, act } from '@testing-library/react';
import { FloatingChatToggle } from '@/components/chat/FloatingChatToggle';
import { useChatChannel } from '@/hooks/useChatChannel';

describe('FloatingChatToggle and useChatChannel (#9753)', () => {
  beforeEach(() => {
    localStorage.clear();
    jest.clearAllMocks();
  });

  describe('FloatingChatToggle component', () => {
    it('renders closed state with message icon and no badge when unreadCount is 0', () => {
      render(<FloatingChatToggle isOpen={false} onToggle={jest.fn()} unreadCount={0} />);

      const button = screen.getByTestId('floating-chat-toggle');
      expect(button).toBeInTheDocument();
      expect(button).toHaveAttribute('aria-expanded', 'false');
      expect(screen.queryByTestId('floating-chat-unread-badge')).not.toBeInTheDocument();
    });

    it('renders unread badge with exact count when closed and unreadCount > 0', () => {
      render(<FloatingChatToggle isOpen={false} onToggle={jest.fn()} unreadCount={5} />);

      const badge = screen.getByTestId('floating-chat-unread-badge');
      expect(badge).toBeInTheDocument();
      expect(badge).toHaveTextContent('5');
    });

    it('clamps unread badge text to 99+ when unreadCount > 99', () => {
      render(<FloatingChatToggle isOpen={false} onToggle={jest.fn()} unreadCount={120} />);

      const badge = screen.getByTestId('floating-chat-unread-badge');
      expect(badge).toBeInTheDocument();
      expect(badge).toHaveTextContent('99+');
    });

    it('does not display badge when drawer is open even if unreadCount > 0', () => {
      render(<FloatingChatToggle isOpen={true} onToggle={jest.fn()} unreadCount={5} />);

      expect(screen.queryByTestId('floating-chat-unread-badge')).not.toBeInTheDocument();
    });

    it('fires onToggle callback when button is clicked', () => {
      const onToggle = jest.fn();
      render(<FloatingChatToggle isOpen={false} onToggle={onToggle} />);

      fireEvent.click(screen.getByTestId('floating-chat-toggle'));
      expect(onToggle).toHaveBeenCalledTimes(1);
    });
  });

  describe('useChatChannel hook', () => {
    it('initializes with default closed state and zero unread count', () => {
      const { result } = renderHook(() => useChatChannel({ roomId: 'test-room' }));

      expect(result.current.isOpen).toBe(false);
      expect(result.current.unreadCount).toBe(0);
    });

    it('increments unread count when incoming message timestamp is greater than lastReadTimestamp and drawer is closed', () => {
      const { result } = renderHook(() =>
        useChatChannel({ roomId: 'room-1', currentUserId: 'user-1' })
      );

      act(() => {
        result.current.onIncomingMessage({
          id: 'msg-1',
          senderId: 'user-2',
          content: 'Hello',
          timestamp: Date.now() + 1000,
        });
      });

      expect(result.current.unreadCount).toBe(1);

      act(() => {
        result.current.onIncomingMessage({
          id: 'msg-2',
          senderId: 'user-2',
          content: 'Another message',
          timestamp: Date.now() + 2000,
        });
      });

      expect(result.current.unreadCount).toBe(2);
    });

    it('does not increment unread count for messages sent by the current user', () => {
      const { result } = renderHook(() =>
        useChatChannel({ roomId: 'room-1', currentUserId: 'user-1' })
      );

      act(() => {
        result.current.onIncomingMessage({
          id: 'msg-self',
          senderId: 'user-1',
          content: 'My message',
          timestamp: Date.now() + 1000,
        });
      });

      expect(result.current.unreadCount).toBe(0);
    });

    it('clears unread count and updates lastReadTimestamp when drawer is opened', () => {
      const { result } = renderHook(() =>
        useChatChannel({ roomId: 'room-1', currentUserId: 'user-1' })
      );

      act(() => {
        result.current.onIncomingMessage({
          id: 'msg-1',
          senderId: 'user-2',
          content: 'Hello',
          timestamp: Date.now() + 1000,
        });
      });

      expect(result.current.unreadCount).toBe(1);

      act(() => {
        result.current.openChat();
      });

      expect(result.current.isOpen).toBe(true);
      expect(result.current.unreadCount).toBe(0);
    });

    it('does not increment unread count when drawer is open', () => {
      const { result } = renderHook(() =>
        useChatChannel({ roomId: 'room-1', initialIsOpen: true })
      );

      act(() => {
        result.current.onIncomingMessage({
          id: 'msg-open',
          senderId: 'user-2',
          content: 'While open',
          timestamp: Date.now() + 1000,
        });
      });

      expect(result.current.unreadCount).toBe(0);
    });
  });
});
