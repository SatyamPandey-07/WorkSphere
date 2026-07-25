"use client";

import React, { useEffect, useState, type ComponentProps } from "react";
import { useUser, UserButton } from "@clerk/nextjs";
import {
  AVATAR_UPDATED_EVENT,
  subscribeAvatarUpdated,
  AvatarUpdatedDetail,
} from "@/lib/avatar-events";
import { ReactiveUserButton as CustomReactiveUserButton } from "./auth/ReactiveUserButton";

type ClerkUserButtonProps = ComponentProps<typeof UserButton>;

/**
 * Props for the {@link ReactiveUserButton} component.
 *
 * Extends Clerk's {@link UserButton} props while adding optional
 * properties for rendering a custom reactive avatar.
 *
 * @property userId - When provided, renders the custom reactive user button
 * instead of Clerk's default {@link UserButton}.
 * @property initialAvatarUrl - Initial avatar image URL used before any
 * avatar update events are received.
 * @property userName - Display name used for avatar fallback text and
 * accessibility labels.
 * @property size - Optional avatar size in pixels.
 * @property className - Additional CSS classes applied to the custom button.
 * @property onClick - Optional click handler for the custom button.
 */
export type ReactiveUserButtonProps = ClerkUserButtonProps & {
  userId?: string;
  initialAvatarUrl?: string | null;
  userName?: string;
  size?: number;
  className?: string;
  onClick?: () => void;
};

/**
 * Renders a user profile button that automatically refreshes its avatar
 * whenever an avatar update event is received.
 *
 * The component behaves in two modes:
 *
 * - If `userId` is provided, it renders the custom
 *   `ReactiveUserButton` implementation that supports reactive avatar
 *   updates without requiring a page reload.
 * - Otherwise, it falls back to Clerk's `UserButton`, forwarding all
 *   inherited props.
 *
 * An internal `avatarRevision` counter is incremented whenever an
 * `AVATAR_UPDATED_EVENT` is dispatched. This revision is included in the
 * rendered `UserButton` key, forcing React to remount the component and
 * bypass any cached avatar image.
 *
 * While Clerk is resolving the current authentication state, the component
 * uses a temporary anonymous key until the authenticated user's information
 * becomes available.
 *
 * @param props Props inherited from Clerk's `UserButton` along with
 * reactive avatar options.
 * @returns A reactive custom user button or Clerk's `UserButton`.
 */
export function ReactiveUserButton(props: ReactiveUserButtonProps) {
  const { user } = useUser();
  // Acts as a cache-busting revision so React remounts the UserButton
  // whenever an avatar update event is received.
  const [avatarRevision, setAvatarRevision] = useState(0);

  useEffect(() => {
    const refreshAvatar = () => {
      setAvatarRevision((revision) => revision + 1);
    };

    const unsubscribe = subscribeAvatarUpdated(
      (_detail: AvatarUpdatedDetail) => {
        refreshAvatar();
      },
    );

    window.addEventListener(AVATAR_UPDATED_EVENT, refreshAvatar);

    return () => {
      unsubscribe();
      window.removeEventListener(AVATAR_UPDATED_EVENT, refreshAvatar);
    };
  }, []);

  if (props.userId) {
    return (
      <CustomReactiveUserButton
        userId={props.userId}
        initialAvatarUrl={props.initialAvatarUrl}
        userName={props.userName}
        size={props.size}
        className={props.className}
        onClick={props.onClick}
      />
    );
  }

  return (
    <UserButton
      key={`${user?.id ?? "anonymous"}:${user?.imageUrl ?? "no-image"}:${avatarRevision}`}
      {...props}
    />
  );
}
