"use client";

import { type RefObject, useEffect } from "react";
import { useAuth } from "@clerk/nextjs";

/**
 * Bridges Clerk session token refresh between the main thread and a Web Worker.
 *
 * Clerk's SDK only runs on the main thread. When a worker makes an
 * authenticated fetch and receives a 401 it cannot call Clerk directly to
 * obtain a fresh JWT. Instead it posts { type: "AUTH_EXPIRED" } to the main
 * thread. This hook listens for that message, calls Clerk's getToken() with
 * skipCache so a fresh JWT is fetched, and replies with
 * { type: "TOKEN_REFRESH", token } so the worker can retry.
 *
 * Usage — mount alongside the hook/component that owns the worker:
 *
 *   const workerRef = useRef<Worker | null>(null);
 *   useWorkerTokenRefresh(workerRef);
 *
 * The worker must implement the complementary protocol:
 *   - Post  { type: "AUTH_EXPIRED" }         when a fetch returns 401.
 *   - Listen for { type: "TOKEN_REFRESH", token: string } to retry.
 */
export function useWorkerTokenRefresh(
  workerRef: RefObject<Worker | null>,
): void {
  const { getToken } = useAuth();

  useEffect(() => {
    const worker = workerRef.current;
    if (!worker) return;

    async function handleMessage(event: MessageEvent): Promise<void> {
      if (event.data?.type !== "AUTH_EXPIRED") return;

      let token: string | null = null;
      try {
        // skipCache forces Clerk to fetch a fresh JWT from its backend rather
        // than serving the locally cached (expired) token.
        token = await getToken({ skipCache: true });
      } catch {
        // getToken throws when the session is fully signed out. The worker will
        // receive an empty token and can decide how to handle it (e.g. break
        // the sync loop and wait for the user to sign in again).
      }

      if (workerRef.current) {
        workerRef.current.postMessage({
          type: "TOKEN_REFRESH",
          token: token ?? "",
        });
      }
    }

    worker.addEventListener("message", handleMessage);
    return () => {
      worker.removeEventListener("message", handleMessage);
    };
  }, [workerRef, getToken]);
}
