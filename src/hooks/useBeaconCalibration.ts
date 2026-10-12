"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  calculateBeaconCalibration,
  type BeaconCalibration,
} from "@/lib/beaconCalibration";

const SAMPLE_DURATION_SECONDS = 10;

type BluetoothAdvertisementEvent = Event & {
  readonly rssi?: number | null;
};

interface BluetoothBeaconDevice extends EventTarget {
  watchAdvertisements?: () => Promise<void>;
  unwatchAdvertisements?: () => Promise<void>;
}

interface BluetoothRequestOptions {
  acceptAllDevices: boolean;
}

interface BluetoothApi {
  requestDevice: (
    options: BluetoothRequestOptions,
  ) => Promise<BluetoothBeaconDevice>;
}

type CalibrationPhase =
  | "idle"
  | "requesting"
  | "sampling"
  | "saving"
  | "complete"
  | "error";

type SaveCalibration = (calibration: BeaconCalibration) => Promise<void>;

export function useBeaconCalibration(onSave: SaveCalibration) {
  const [phase, setPhase] = useState<CalibrationPhase>("idle");
  const [activeSample, setActiveSample] = useState<1 | 2 | null>(null);
  const [secondsRemaining, setSecondsRemaining] = useState(0);
  const [samples, setSamples] = useState<[number[], number[]]>([[], []]);
  const [calibration, setCalibration] = useState<BeaconCalibration | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  const deviceRef = useRef<BluetoothBeaconDevice | null>(null);
  const listenerRef = useRef<((event: Event) => void) | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const secondsRemainingRef = useRef(0);
  const activeSampleRef = useRef<0 | 1 | null>(null);
  const samplesRef = useRef<[number[], number[]]>([[], []]);
  const runIdRef = useRef(0);
  const mountedRef = useRef(true);

  const stopScan = useCallback(() => {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    activeSampleRef.current = null;

    const device = deviceRef.current;
    const listener = listenerRef.current;
    if (device && listener) {
      device.removeEventListener("advertisementreceived", listener);
    }
    if (device?.unwatchAdvertisements) {
      void device.unwatchAdvertisements().catch((scanError: unknown) => {
        console.warn("Failed to stop Bluetooth beacon advertisements:", scanError);
      });
    }
    deviceRef.current = null;
    listenerRef.current = null;
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      stopScan();
    };
  }, [stopScan]);

  const cancel = useCallback(() => {
    runIdRef.current += 1;
    stopScan();
    setActiveSample(null);
    setSecondsRemaining(0);
    setPhase("idle");
    setError(null);
  }, [stopScan]);

  const startCalibration = useCallback(
    async (firstDistance: number, secondDistance: number) => {
      if (
        !Number.isFinite(firstDistance) ||
        !Number.isFinite(secondDistance) ||
        firstDistance <= 0 ||
        secondDistance <= 0 ||
        firstDistance === secondDistance
      ) {
        setError("Enter two positive, different calibration distances.");
        setPhase("error");
        return;
      }

      const runId = ++runIdRef.current;
      const bluetooth =
        typeof navigator === "undefined"
          ? undefined
          : (navigator as Navigator & { bluetooth?: BluetoothApi }).bluetooth;
      if (!bluetooth?.requestDevice) {
        setError("Bluetooth beacon scanning is not supported in this browser.");
        setPhase("error");
        return;
      }

      stopScan();
      samplesRef.current = [[], []];
      setSamples([[], []]);
      setCalibration(null);
      setError(null);
      setPhase("requesting");

      try {
        const device = await bluetooth.requestDevice({ acceptAllDevices: true });
        if (!mountedRef.current || runId !== runIdRef.current) return;
        if (!device.watchAdvertisements) {
          throw new Error(
            "This browser cannot receive Bluetooth advertisement RSSI values.",
          );
        }

        deviceRef.current = device;
        const listener = (event: Event) => {
          const index = activeSampleRef.current;
          const rssi = (event as BluetoothAdvertisementEvent).rssi;
          if (
            index === null ||
            typeof rssi !== "number" ||
            !Number.isFinite(rssi)
          ) {
            return;
          }
          samplesRef.current[index].push(rssi);
          setSamples([
            [...samplesRef.current[0]],
            [...samplesRef.current[1]],
          ]);
        };
        listenerRef.current = listener;
        device.addEventListener("advertisementreceived", listener);
        await device.watchAdvertisements();
        if (!mountedRef.current || runId !== runIdRef.current) {
          stopScan();
          return;
        }

        activeSampleRef.current = 0;
        secondsRemainingRef.current = SAMPLE_DURATION_SECONDS;
        setActiveSample(1);
        setSecondsRemaining(SAMPLE_DURATION_SECONDS);
        setPhase("sampling");

        timerRef.current = setInterval(() => {
          secondsRemainingRef.current -= 1;
          setSecondsRemaining(secondsRemainingRef.current);
          if (secondsRemainingRef.current > 0) return;

          if (activeSampleRef.current === 0) {
            activeSampleRef.current = 1;
            secondsRemainingRef.current = SAMPLE_DURATION_SECONDS;
            setActiveSample(2);
            setSecondsRemaining(SAMPLE_DURATION_SECONDS);
            return;
          }

          stopScan();
          setActiveSample(null);
          setPhase("saving");
          const [firstSamples, secondSamples] = samplesRef.current;
          try {
            const result = calculateBeaconCalibration(
              firstSamples,
              firstDistance,
              secondSamples,
              secondDistance,
            );
            setCalibration(result);
            void onSave(result)
              .then(() => {
                if (mountedRef.current) setPhase("complete");
              })
              .catch((saveError: unknown) => {
                if (!mountedRef.current) return;
                setError(
                  saveError instanceof Error
                    ? saveError.message
                    : "Failed to save beacon calibration.",
                );
                setPhase("error");
              });
          } catch (calculationError) {
            if (mountedRef.current) {
              setError(
                calculationError instanceof Error
                  ? calculationError.message
                  : "Could not calculate beacon calibration.",
              );
              setPhase("error");
            }
          }
        }, 1000);
      } catch (scanError) {
        stopScan();
        if (!mountedRef.current || runId !== runIdRef.current) return;
        setError(
          scanError instanceof Error
            ? scanError.message
            : "Could not start Bluetooth beacon scanning.",
        );
        setPhase("error");
      }
    },
    [onSave, stopScan],
  );

  return {
    phase,
    activeSample,
    secondsRemaining,
    samples,
    calibration,
    error,
    startCalibration,
    cancel,
  };
}
