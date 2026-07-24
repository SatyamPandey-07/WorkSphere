"use client";

import React, { useState, useEffect } from "react";
import Image from "next/image";
import { User } from "lucide-react";
import {
  subscribeAvatarUpdated,
  AvatarUpdatedDetail,
} from "@/lib/avatar-events";

export interface ReactiveUserButtonProps {
  /** User ID to match incoming custom event updates */
  userId: string;
  /** Initial avatar image URL */
  initialAvatarUrl?: string | null;
  /** User display name or email */
  userName?: string;
  /** Size in pixels (default: 36) */
  size?: number;
  /** Optional custom CSS class name */
  className?: string;
  /** Click handler */
  onClick?: () => void;
}

/**
 * ReactiveUserButton Component
 *
 * Displays a user profile avatar button that listens for custom `worksphere:avatar-updated`
 * window events emitted by `avatar-events.ts`. Updates its local state reactively upon avatar
 * upload, preventing full page re-renders or router refreshes.
 */
export function ReactiveUserButton({
  userId,
  initialAvatarUrl,
  userName = "User Profile",
  size = 36,
  className = "",
  onClick,
}: ReactiveUserButtonProps) {
  const [avatarUrl, setAvatarUrl] = useState<string | null>(
    initialAvatarUrl || null,
  );
  const [imageError, setImageError] = useState<boolean>(false);

  useEffect(() => {
    setAvatarUrl(initialAvatarUrl || null);
    setImageError(false);
  }, [initialAvatarUrl]);

  // Subscribe to reactive avatar update CustomEvent
  useEffect(() => {
    const unsubscribe = subscribeAvatarUpdated(
      (detail: AvatarUpdatedDetail) => {
        if (detail.userId === userId && detail.avatarUrl) {
          setAvatarUrl(detail.avatarUrl);
          setImageError(false);
        }
      },
    );

    return () => unsubscribe();
  }, [userId]);

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Open profile menu for ${userName}`}
      title={userName}
      className={`relative inline-flex items-center justify-center overflow-hidden rounded-full border-2 border-zinc-200 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-800 transition-transform active:scale-95 focus:outline-none focus:ring-2 focus:ring-blue-500 ${className}`}
      style={{ width: `${size}px`, height: `${size}px` }}
    >
      {avatarUrl && !imageError ? (
        <Image
          src={avatarUrl}
          alt={userName}
          width={size}
          height={size}
          unoptimized
          onError={() => setImageError(true)}
          className="h-full w-full object-cover rounded-full"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-indigo-100 text-indigo-600 dark:bg-indigo-950 dark:text-indigo-300 font-bold text-xs uppercase">
          {userName && userName.length > 0 ? (
            userName.slice(0, 2).toUpperCase()
          ) : (
            <User className="h-4 w-4" />
          )}
        </div>
      )}
    </button>
  );
}
