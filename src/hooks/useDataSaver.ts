"use client";

import { useState, useEffect, useCallback } from "react";
import {
  getDataSaverState,
  setDataSaverState,
  getEstimatedSavedMB,
  recordDataSaved,
  DATA_SAVER_CHANGE_EVENT,
} from "@/lib/dataSaver";

export function useDataSaver(initialEnabled?: boolean) {
  const [isDataSaver, setIsDataSaver] = useState<boolean>(() => {
    if (typeof initialEnabled === "boolean") return initialEnabled;
    return getDataSaverState();
  });

  const [estimatedSavedMB, setEstimatedSavedMBState] = useState<number>(() =>
    getEstimatedSavedMB(),
  );

  useEffect(() => {
    // Sync initial state from localStorage on mount
    setIsDataSaver(getDataSaverState());
    setEstimatedSavedMBState(getEstimatedSavedMB());

    const handleSync = () => {
      setIsDataSaver(getDataSaverState());
      setEstimatedSavedMBState(getEstimatedSavedMB());
    };

    window.addEventListener("storage", handleSync);
    window.addEventListener(DATA_SAVER_CHANGE_EVENT, handleSync);

    return () => {
      window.removeEventListener("storage", handleSync);
      window.removeEventListener(DATA_SAVER_CHANGE_EVENT, handleSync);
    };
  }, []);

  const toggleDataSaver = useCallback((enabled: boolean) => {
    setIsDataSaver(enabled);
    setDataSaverState(enabled);
  }, []);

  const trackSavings = useCallback((deltaMB: number) => {
    recordDataSaved(deltaMB);
    setEstimatedSavedMBState(getEstimatedSavedMB());
  }, []);

  return {
    isDataSaver,
    setDataSaver: toggleDataSaver,
    estimatedSavedMB,
    recordSavings: trackSavings,
  };
}
