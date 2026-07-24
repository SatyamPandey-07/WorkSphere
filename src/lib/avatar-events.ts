export const AVATAR_UPDATED_EVENT = "worksphere:avatar-updated";

export type AvatarUpdatedDetail = {
  userId: string;
  avatarUrl: string;
  timestamp: number;
};

export type AvatarUpdatedListener = (detail: AvatarUpdatedDetail) => void;

/**
 * Broadcasts an avatar update to components that render the active user's
 * profile image.
 */
export function dispatchAvatarUpdated(userId: string, avatarUrl: string): void {
  if (typeof window === "undefined") {
    return;
  }

  const detail: AvatarUpdatedDetail = {
    userId,
    avatarUrl,
    timestamp: Date.now(),
  };

  window.dispatchEvent(
    new CustomEvent<AvatarUpdatedDetail>(AVATAR_UPDATED_EVENT, { detail }),
  );
}

/**
 * Subscribes to avatar update events and returns an unsubscribe function.
 */
export function subscribeAvatarUpdated(
  listener: AvatarUpdatedListener,
): () => void {
  if (typeof window === "undefined") {
    return () => undefined;
  }

  const handleAvatarUpdated = (event: Event) => {
    const customEvent = event as CustomEvent<AvatarUpdatedDetail>;

    listener(customEvent.detail);
  };

  window.addEventListener(AVATAR_UPDATED_EVENT, handleAvatarUpdated);

  return () => {
    window.removeEventListener(AVATAR_UPDATED_EVENT, handleAvatarUpdated);
  };
}
