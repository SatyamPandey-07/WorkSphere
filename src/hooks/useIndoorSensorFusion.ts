"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  IndoorPdrEngine,
  ImuSample,
  BeaconReading,
  PdrState,
  StepDetectionResult,
  UncertaintyEllipse,
  PdrConfig,
} from "@/lib/spatial/indoorPdrEngine";

export interface UseIndoorSensorFusionOptions {
  initialPosition?: { x: number; y: number; heading: number };
  config?: Partial<PdrConfig>;
  knownBeacons?: BeaconReading[];
  autoStartSensors?: boolean;
}

export function useIndoorSensorFusion(
  options: UseIndoorSensorFusionOptions = {}
) {
  const {
    initialPosition = { x: 0, y: 0, heading: 0 },
    config,
    knownBeacons = [],
    autoStartSensors = false,
  } = options;

  const engineRef = useRef<IndoorPdrEngine | null>(null);
  if (!engineRef.current) {
    engineRef.current = new IndoorPdrEngine(initialPosition, config);
  }

  const [state, setState] = useState<PdrState>(engineRef.current.getState());
  const [uncertaintyEllipse, setUncertaintyEllipse] = useState<UncertaintyEllipse>(
    engineRef.current.getUncertaintyEllipse()
  );
  const [trajectory, setTrajectory] = useState<Array<{ x: number; y: number; timestamp: number }>>(
    engineRef.current.getTrajectory()
  );
  const [lastStep, setLastStep] = useState<StepDetectionResult | null>(null);
  const [isSensorActive, setIsSensorActive] = useState(false);
  const [permissionState, setPermissionState] = useState<"prompt" | "granted" | "denied" | "unsupported">("prompt");
  const [detectedBeacons, setDetectedBeacons] = useState<BeaconReading[]>(knownBeacons);

  const compassHeadingRef = useRef<number | undefined>(undefined);
  const orientationHandlerRef = useRef<((e: DeviceOrientationEvent) => void) | null>(null);
  const motionHandlerRef = useRef<((e: DeviceMotionEvent) => void) | null>(null);

  // Update state helper
  const syncState = useCallback(() => {
    if (!engineRef.current) return;
    setState(engineRef.current.getState());
    setUncertaintyEllipse(engineRef.current.getUncertaintyEllipse());
    setTrajectory(engineRef.current.getTrajectory());
  }, []);

  // Ingest external IMU sample
  const feedImuSample = useCallback(
    (sample: ImuSample) => {
      if (!engineRef.current) return null;
      const stepResult = engineRef.current.processImuSample(sample);
      if (stepResult) {
        setLastStep(stepResult);
      }
      syncState();
      return stepResult;
    },
    [syncState]
  );

  // Ingest beacon readings batch (trilateration + EKF)
  const feedBeaconReadings = useCallback(
    (readings: BeaconReading[]) => {
      if (!engineRef.current) return null;
      setDetectedBeacons(readings);
      const fix = engineRef.current.processBeaconReadings(readings);
      syncState();
      return fix;
    },
    [syncState]
  );

  // Ingest single BLE beacon RSSI range update
  const feedSingleBeaconRssi = useCallback(
    (beacon: BeaconReading) => {
      if (!engineRef.current) return false;
      const accepted = engineRef.current.processSingleBeaconRssi(beacon);
      syncState();
      return accepted;
    },
    [syncState]
  );

  // Manual step simulation (useful for testing or desktop navigation)
  const simulateStep = useCallback(
    (stepLength = 0.75, headingDeg?: number) => {
      if (!engineRef.current) return;
      const currentH = headingDeg !== undefined ? (headingDeg * Math.PI) / 180 : state.heading;
      // Synthesize an IMU sample with vertical acceleration swing
      const now = Date.now();
      feedImuSample({
        timestamp: now,
        ax: 0,
        ay: 0,
        az: 12.5, // peak acceleration
        gz: 0,
        headingDeg: headingDeg ?? state.headingDegrees,
      });
      feedImuSample({
        timestamp: now + 150,
        ax: 0,
        ay: 0,
        az: 7.2, // valley acceleration
        gz: 0,
        headingDeg: headingDeg ?? state.headingDegrees,
      });
    },
    [feedImuSample, state.heading, state.headingDegrees]
  );

  // Reset filter
  const reset = useCallback(
    (newPos = { x: 0, y: 0, heading: 0 }) => {
      if (!engineRef.current) return;
      engineRef.current.reset(newPos);
      setLastStep(null);
      syncState();
    },
    [syncState]
  );

  const stopSensors = useCallback(() => {
    if (typeof window !== "undefined") {
      if (orientationHandlerRef.current) {
        window.removeEventListener("deviceorientation", orientationHandlerRef.current);
        orientationHandlerRef.current = null;
      }
      if (motionHandlerRef.current) {
        window.removeEventListener("devicemotion", motionHandlerRef.current);
        motionHandlerRef.current = null;
      }
    }
    setIsSensorActive(false);
  }, []);

  // Start mobile browser device motion / orientation listeners
  const startSensors = useCallback(async () => {
    if (typeof window === "undefined") return false;

    try {
      // iOS 13+ permission request
      const Motion = window.DeviceMotionEvent as unknown as {
        requestPermission?: () => Promise<"granted" | "denied">;
      };

      if (typeof Motion?.requestPermission === "function") {
        const res = await Motion.requestPermission();
        if (res !== "granted") {
          setPermissionState("denied");
          return false;
        }
      }

      setPermissionState("granted");

      // Stop any existing listeners before attaching new ones
      stopSensors();

      // Device orientation handler for magnetometer heading
      const handleOrientation = (e: DeviceOrientationEvent) => {
        let heading: number | undefined;
        if (typeof (e as unknown as { webkitCompassHeading?: number }).webkitCompassHeading === "number") {
          heading = (e as unknown as { webkitCompassHeading: number }).webkitCompassHeading;
        } else if (e.alpha !== null) {
          heading = 360 - e.alpha;
        }
        compassHeadingRef.current = heading;
      };

      // Device motion handler for accelerometer & gyroscope
      const handleMotion = (e: DeviceMotionEvent) => {
        if (!e.accelerationIncludingGravity) return;
        const ax = e.accelerationIncludingGravity.x ?? 0;
        const ay = e.accelerationIncludingGravity.y ?? 0;
        const az = e.accelerationIncludingGravity.z ?? 9.8;
        const gz = (e.rotationRate?.alpha ?? 0) * (Math.PI / 180);

        feedImuSample({
          timestamp: Date.now(),
          ax,
          ay,
          az,
          gz,
          headingDeg: compassHeadingRef.current,
        });
      };

      orientationHandlerRef.current = handleOrientation;
      motionHandlerRef.current = handleMotion;

      window.addEventListener("deviceorientation", handleOrientation);
      window.addEventListener("devicemotion", handleMotion);

      setIsSensorActive(true);

      return true;
    } catch (err) {
      console.error("Failed to start device motion sensors:", err);
      setPermissionState("denied");
      return false;
    }
  }, [feedImuSample, stopSensors]);

  useEffect(() => {
    if (autoStartSensors) {
      startSensors();
    }
    return () => {
      stopSensors();
    };
  }, [autoStartSensors, startSensors, stopSensors]);

  return {
    state,
    uncertaintyEllipse,
    trajectory,
    lastStep,
    isSensorActive,
    permissionState,
    detectedBeacons,
    feedImuSample,
    feedBeaconReadings,
    feedSingleBeaconRssi,
    simulateStep,
    startSensors,
    stopSensors,
    reset,
  };
}
