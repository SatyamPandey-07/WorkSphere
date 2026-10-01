"use client";

import { useEffect, useRef } from "react";
import { useToast } from "@/components/ui/Toast";

export function PWAUpdateListener() {
  const { toast } = useToast();
  const waitingWorkerRef = useRef<ServiceWorker | null>(null);
  const toastShownRef = useRef(false);
  const refreshingRef = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;

    // Reload the page once the new service worker takes control.
    // A guard prevents a second reload if useServiceWorker's own
    // controllerchange listener fires in the same page load.
    const handleControllerChange = () => {
      if (!refreshingRef.current) {
        refreshingRef.current = true;
        window.location.reload();
      }
    };

    navigator.serviceWorker.addEventListener(
      "controllerchange",
      handleControllerChange,
    );

    const showUpdateToast = (sw: ServiceWorker) => {
      if (toastShownRef.current) return;
      toastShownRef.current = true;
      waitingWorkerRef.current = sw;

      toast("New version available", "success", {
        label: "Update Now",
        onClick: () => {
          waitingWorkerRef.current?.postMessage({ type: "SKIP_WAITING" });
        },
      });
    };

    // Listen for the custom event dispatched by useServiceWorker when a new
    // SW finishes installing while the page is open.
    const handleCustomEvent = (e: Event) => {
      const customEvent = e as CustomEvent<ServiceWorker>;
      if (customEvent.detail) {
        showUpdateToast(customEvent.detail);
      }
    };

    window.addEventListener("pwa-update-available", handleCustomEvent);

    // Direct registration check: catches cases where the component mounts
    // after the SW has already entered the `waiting` state (e.g. a hard
    // refresh while a pending update exists).
    navigator.serviceWorker.getRegistration().then((reg) => {
      if (!reg) return;

      if (reg.waiting) {
        showUpdateToast(reg.waiting);
      }

      reg.addEventListener("updatefound", () => {
        const installing = reg.installing;
        if (!installing) return;

        installing.addEventListener("statechange", () => {
          if (
            installing.state === "installed" &&
            navigator.serviceWorker.controller
          ) {
            showUpdateToast(installing);
          }
        });
      });
    });

    return () => {
      navigator.serviceWorker.removeEventListener(
        "controllerchange",
        handleControllerChange,
      );
      window.removeEventListener("pwa-update-available", handleCustomEvent);
    };
  }, [toast]);

  return null;
}
