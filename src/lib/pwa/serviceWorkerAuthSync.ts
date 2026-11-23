"use client";

export const SW_SIGN_OUT_MESSAGE = { type: "SIGN_OUT" } as const;

/**
 * Notifies the active Service Worker to purge all dynamic runtime caches
 * during Clerk's signOut() lifecycle and cleans up any residual CacheStorage
 * entries on the window context as defense-in-depth.
 */
export async function purgeServiceWorkerCachesOnSignOut(
  timeoutMs = 1500,
): Promise<void> {
  if (typeof window === "undefined") {
    return;
  }

  // 1. Signal active Service Worker controller via MessageChannel with timeout guard
  if ("serviceWorker" in navigator && navigator.serviceWorker.controller) {
    const controller = navigator.serviceWorker.controller;

    await new Promise<void>((resolve) => {
      const channel = new MessageChannel();
      const timer = setTimeout(() => {
        resolve();
      }, timeoutMs);

      channel.port1.onmessage = () => {
        clearTimeout(timer);
        resolve();
      };

      try {
        controller.postMessage(SW_SIGN_OUT_MESSAGE, [channel.port2]);
      } catch {
        clearTimeout(timer);
        resolve();
      }
    });
  }

  // 2. Defense-in-depth: directly purge non-static CacheStorage buckets from window context
  if ("caches" in window) {
    try {
      const keys = await window.caches.keys();
      await Promise.all(
        keys
          .filter((key) => !key.startsWith("worksphere-static-"))
          .map((key) => window.caches.delete(key)),
      );
    } catch {
      // Ignore storage errors in restricted/incognito contexts
    }
  }

  // 3. Clear browser pushManager subscription so next account does not inherit it
  if ("serviceWorker" in navigator) {
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg?.pushManager?.getSubscription();
      if (sub) {
        await sub.unsubscribe().catch(() => {});
      }
    } catch {
      // Ignore pushManager errors during sign-out
    }
  }
}

/**
 * Wraps Clerk's `signOut` function so dynamic runtime caches are purged
 * immediately whenever a user signs out on a shared terminal.
 */
export function createCacheSafeSignOut<TArgs extends unknown[], TResult>(
  clerkSignOut: (...args: TArgs) => Promise<TResult>,
): (...args: TArgs) => Promise<TResult> {
  return async (...args: TArgs): Promise<TResult> => {
    await purgeServiceWorkerCachesOnSignOut();
    return clerkSignOut(...args);
  };
}
