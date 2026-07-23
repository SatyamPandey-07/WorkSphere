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

export type ReactiveUserButtonProps = ClerkUserButtonProps & {
  userId?: string;
  initialAvatarUrl?: string | null;
  userName?: string;
  size?: number;
  className?: string;
  onClick?: () => void;
};

export function ReactiveUserButton(props: ReactiveUserButtonProps) {
  const { user } = useUser();
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
