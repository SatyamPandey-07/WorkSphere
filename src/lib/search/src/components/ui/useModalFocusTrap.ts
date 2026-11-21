import { useEffect, useRef } from 'react';

export interface UseModalFocusTrapOptions {
  isOpen: boolean;
  onClose: () => void;
  containerRef?: React.RefObject<HTMLElement | null>;
  restoreFocus?: boolean;
}

export function useModalFocusTrap({
  isOpen,
  onClose,
  containerRef,
  restoreFocus = true,
}: UseModalFocusTrapOptions): void {
  const previousActiveElementRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!isOpen || typeof document === 'undefined') {
      return;
    }

    const activeEl = document.activeElement;
    if (activeEl instanceof HTMLElement) {
      previousActiveElementRef.current = activeEl;
    }

    const container = containerRef?.current;
    if (container && !container.contains(document.activeElement)) {
      const focusable = container.querySelector<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      if (focusable) {
        focusable.focus();
      } else if (container.tabIndex >= 0) {
        container.focus();
      }
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.altKey && !event.ctrlKey && !event.metaKey) {
        event.preventDefault();
        onCloseRef.current();
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      if (restoreFocus && previousActiveElementRef.current?.isConnected) {
        previousActiveElementRef.current.focus();
      }
      previousActiveElementRef.current = null;
    };
  }, [isOpen, containerRef, restoreFocus]);
}