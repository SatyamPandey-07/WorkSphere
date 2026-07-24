"use client";

import { useEffect } from "react";
import { useToast } from "@/components/ui/Toast";

export function PWAUpdateListener() {
  const { toast } = useToast();

  useEffect(() => {
    const handleUpdate = (e: Event) => {
      const customEvent = e as CustomEvent<ServiceWorker>;
      const waitingWorker = customEvent.detail;

      toast("New version available.", "success", {
        label: "Click here to reload",
        onClick: () => {
          waitingWorker?.postMessage({ type: "SKIP_WAITING" });
        },
      });
    };

    window.addEventListener("pwa-update-available", handleUpdate);
    return () =>
      window.removeEventListener("pwa-update-available", handleUpdate);
  }, [toast]);

  return null;
}
