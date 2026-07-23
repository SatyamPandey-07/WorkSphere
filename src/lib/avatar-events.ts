/**
 * Avatar Update Event Infrastructure (src/lib/avatar-events.ts)
 *
 * Implements a lightweight, decoupled CustomEvent bus for real-time avatar updates
 * across UI components (such as ReactiveUserButton, TopNav, and Profile headers)
 * without triggering full page re-renders or unneeded server data re-fetches.
 */

export const AVATAR_UPDATED_EVENT = "worksphere:avatar-updated";

export interface AvatarUpdatedDetail {
  /** The unique user ID associated with the updated avatar */
  userId: string;
  /** The new avatar image URL */
  avatarUrl: string;
  /** Unix timestamp in milliseconds when the event was dispatched */
  timestamp: number;
}

export type AvatarUpdatedCustomEvent = CustomEvent<AvatarUpdatedDetail>;

/**
 * Dispatches a custom event indicating that a user's avatar has been updated.
 *
 * @param userId - Unique identifier of the user
 * @param avatarUrl - New URL for the user's avatar image
 */
export function dispatchAvatarUpdated(userId: string, avatarUrl: string): void {
  if (typeof window === "undefined") return;

  const detail: AvatarUpdatedDetail = {
    userId,
    avatarUrl,
    timestamp: Date.now(),
  };

  const event = new CustomEvent<AvatarUpdatedDetail>(AVATAR_UPDATED_EVENT, {
    detail,
    bubbles: true,
    cancelable: true,
  });

  window.dispatchEvent(event);
}

/** Legacy / simple event notifier alias */
export function notifyAvatarUpdated(): void {
  dispatchAvatarUpdated("", "");
}

/**
 * Subscribes a callback function to custom avatar update events on the window object.
 * Returns an unsubscribe cleanup function.
 *
 * @param callback - Function invoked when an avatar update event is fired
 * @returns Function to remove the event listener
 */
export function subscribeAvatarUpdated(
  callback: (detail: AvatarUpdatedDetail) => void,
): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }

  const handler = (event: Event) => {
    const customEvent = event as CustomEvent<AvatarUpdatedDetail>;
    if (customEvent.detail) {
      callback(customEvent.detail);
    }
  };

  window.addEventListener(AVATAR_UPDATED_EVENT, handler);

  return () => {
    window.removeEventListener(AVATAR_UPDATED_EVENT, handler);
  };
}
