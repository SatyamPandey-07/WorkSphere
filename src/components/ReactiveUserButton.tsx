"use client";

import { useEffect, useState, type ComponentProps } from "react";
import { useUser, UserButton } from "@clerk/nextjs";
import { AVATAR_UPDATED_EVENT } from "@/lib/avatar-events";

type ReactiveUserButtonProps = ComponentProps<typeof UserButton>;

export function ReactiveUserButton(props: ReactiveUserButtonProps) {
  const { user } = useUser();
  const [avatarRevision, setAvatarRevision] = useState(0);

  useEffect(() => {
    const refreshAvatar = () => {
      setAvatarRevision((revision) => revision + 1);
    };

    window.addEventListener(AVATAR_UPDATED_EVENT, refreshAvatar);

    return () => {
      window.removeEventListener(AVATAR_UPDATED_EVENT, refreshAvatar);
    };
  }, []);

  return (
    <UserButton
      key={`${user?.id ?? "anonymous"}:${user?.imageUrl ?? "no-image"}:${avatarRevision}`}
      {...props}
    />
  );
}
