export const AVATAR_UPDATED_EVENT = "worksphere:avatar-updated";

export function notifyAvatarUpdated() {
  window.dispatchEvent(new CustomEvent(AVATAR_UPDATED_EVENT));
}
