"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useToast } from "@/components/ui/Toast";

export const BATTERY_SERVICE_UUID = "battery_service";
export const BATTERY_SERVICE_UUID_HEX = 0x180f;
export const BATTERY_LEVEL_CHARACTERISTIC_UUID = "battery_level";
export const BATTERY_LEVEL_CHARACTERISTIC_HEX = 0x2a19;
export const DEFAULT_LOW_BATTERY_THRESHOLD = 15;

export interface BleGattCharacteristic {
  value?: DataView | null;
  readValue: () => Promise<DataView>;
  startNotifications?: () => Promise<BleGattCharacteristic>;
  stopNotifications?: () => Promise<BleGattCharacteristic>;
  addEventListener: (
    type: string,
    listener: (this: BleGattCharacteristic, ev: Event) => void,
  ) => void;
  removeEventListener: (
    type: string,
    listener: (this: BleGattCharacteristic, ev: Event) => void,
  ) => void;
}

export interface BleGattService {
  getCharacteristic: (
    characteristic: string | number,
  ) => Promise<BleGattCharacteristic>;
}

export interface BleGattServer {
  connected: boolean;
  device?: BleDevice;
  connect: () => Promise<BleGattServer>;
  disconnect: () => void;
  getPrimaryService: (service: string | number) => Promise<BleGattService>;
}

export interface BleDevice extends EventTarget {
  id: string;
  name?: string;
  gatt?: BleGattServer;
  addEventListener: (
    type: string,
    listener: EventListenerOrEventListenerObject,
  ) => void;
  removeEventListener: (
    type: string,
    listener: EventListenerOrEventListenerObject,
  ) => void;
}

export interface RequestDeviceOptions {
  acceptAllDevices?: boolean;
  filters?: Array<{
    services?: Array<string | number>;
    name?: string;
    namePrefix?: string;
  }>;
  optionalServices?: Array<string | number>;
}

export interface WebBluetoothNavigator {
  bluetooth?: {
    requestDevice: (options: RequestDeviceOptions) => Promise<BleDevice>;
    getAvailability?: () => Promise<boolean>;
  };
}

export interface UseBleBatteryMonitorOptions {
  threshold?: number;
  autoAlert?: boolean;
  requestOptions?: RequestDeviceOptions;
  onBatteryLevelChange?: (level: number) => void;
  onLowBattery?: (level: number, deviceName: string) => void;
  onDisconnect?: () => void;
}

export interface BleBatteryMonitorState {
  batteryLevel: number | null;
  deviceName: string | null;
  deviceId: string | null;
  isConnected: boolean;
  isConnecting: boolean;
  isSupported: boolean;
  isLowBattery: boolean;
  error: string | null;
  connect: () => Promise<void>;
  disconnect: () => void;
}

/**
 * Extracts battery level percentage (0-100) from Bluetooth SIG Battery Level characteristic DataView.
 */
export function parseBatteryLevel(dataView: DataView): number {
  if (!dataView || dataView.byteLength < 1) {
    throw new Error("Invalid DataView: cannot parse battery level");
  }
  return dataView.getUint8(0);
}

/**
 * Hook to monitor Bluetooth Low Energy (BLE) peripheral battery health and trigger low-charge alerts.
 * Connects over Web Bluetooth Battery Service (UUID 0x180F) and alerts when level is <= 15%.
 */
export function useBleBatteryMonitor(
  options: UseBleBatteryMonitorOptions = {},
): BleBatteryMonitorState {
  const {
    threshold = DEFAULT_LOW_BATTERY_THRESHOLD,
    autoAlert = true,
    requestOptions,
    onBatteryLevelChange,
    onLowBattery,
    onDisconnect,
  } = options;

  const { toast } = useToast();

  const [batteryLevel, setBatteryLevel] = useState<number | null>(null);
  const [deviceName, setDeviceName] = useState<string | null>(null);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [isConnecting, setIsConnecting] = useState<boolean>(false);
  const [isLowBattery, setIsLowBattery] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const deviceRef = useRef<BleDevice | null>(null);
  const characteristicRef = useRef<BleGattCharacteristic | null>(null);
  const hasAlertedRef = useRef<boolean>(false);
  const deviceNameRef = useRef<string | null>(null);

  // Keep device name ref updated
  useEffect(() => {
    deviceNameRef.current = deviceName;
  }, [deviceName]);

  const checkIsSupported = useCallback((): boolean => {
    if (typeof navigator === "undefined") return false;
    const nav = navigator as unknown as WebBluetoothNavigator;
    return !!nav.bluetooth && typeof nav.bluetooth.requestDevice === "function";
  }, []);

  const [isSupported, setIsSupported] = useState<boolean>(checkIsSupported);

  useEffect(() => {
    setIsSupported(checkIsSupported());
  }, [checkIsSupported]);

  const handleBatteryLevel = useCallback(
    (level: number, name: string) => {
      setBatteryLevel(level);
      const isLow = level <= threshold;
      setIsLowBattery(isLow);

      if (isLow) {
        onLowBattery?.(level, name);
        if (autoAlert && !hasAlertedRef.current) {
          hasAlertedRef.current = true;
          toast(
            `Low battery alert: ${name || "Peripheral"} is at ${level}%. Please recharge soon.`,
            "warning",
          );
        }
      } else {
        // Reset alerted flag if battery is charged above threshold
        hasAlertedRef.current = false;
      }

      onBatteryLevelChange?.(level);
    },
    [threshold, autoAlert, onLowBattery, onBatteryLevelChange, toast],
  );

  const onCharacteristicValueChanged = useCallback(
    (event: Event) => {
      const target = event.target as unknown as BleGattCharacteristic;
      if (target?.value) {
        try {
          const level = parseBatteryLevel(target.value);
          handleBatteryLevel(level, deviceNameRef.current || "BLE Peripheral");
        } catch (err) {
          console.warn("Failed to parse battery characteristic value:", err);
        }
      }
    },
    [handleBatteryLevel],
  );

  const handleDisconnected = useCallback(() => {
    setIsConnected(false);
    setIsConnecting(false);
    setBatteryLevel(null);
    setIsLowBattery(false);
    hasAlertedRef.current = false;

    if (characteristicRef.current) {
      characteristicRef.current.removeEventListener(
        "characteristicvaluechanged",
        onCharacteristicValueChanged,
      );
      characteristicRef.current = null;
    }
    deviceRef.current = null;

    onDisconnect?.();
  }, [onCharacteristicValueChanged, onDisconnect]);

  const disconnect = useCallback(() => {
    if (characteristicRef.current) {
      characteristicRef.current.removeEventListener(
        "characteristicvaluechanged",
        onCharacteristicValueChanged,
      );
      if (typeof characteristicRef.current.stopNotifications === "function") {
        characteristicRef.current.stopNotifications().catch(() => {});
      }
      characteristicRef.current = null;
    }

    if (deviceRef.current) {
      deviceRef.current.removeEventListener(
        "gattserverdisconnected",
        handleDisconnected,
      );
      if (deviceRef.current.gatt?.connected) {
        deviceRef.current.gatt.disconnect();
      }
      deviceRef.current = null;
    }

    setIsConnected(false);
    setIsConnecting(false);
    setBatteryLevel(null);
    setIsLowBattery(false);
    hasAlertedRef.current = false;
    setError(null);
  }, [handleDisconnected, onCharacteristicValueChanged]);

  const connect = useCallback(async () => {
    if (!checkIsSupported()) {
      const msg = "Web Bluetooth is not supported in this browser environment.";
      setError(msg);
      return;
    }

    const nav = navigator as unknown as WebBluetoothNavigator;
    if (!nav.bluetooth) return;

    setIsConnecting(true);
    setError(null);

    try {
      const defaultOptions: RequestDeviceOptions = {
        acceptAllDevices: true,
        optionalServices: [
          BATTERY_SERVICE_UUID,
          BATTERY_SERVICE_UUID_HEX,
        ],
      };

      const finalOptions = requestOptions || defaultOptions;
      const device = await nav.bluetooth.requestDevice(finalOptions);

      if (!device) {
        throw new Error("No BLE device was selected.");
      }

      deviceRef.current = device;
      setDeviceId(device.id || null);
      const name = device.name || "BLE Peripheral";
      setDeviceName(name);
      deviceNameRef.current = name;

      device.addEventListener("gattserverdisconnected", handleDisconnected);

      const server = await device.gatt?.connect();
      if (!server) {
        throw new Error("Failed to establish connection with GATT server.");
      }

      // Obtain Battery Service (UUID 0x180F)
      let service: BleGattService;
      try {
        service = await server.getPrimaryService(BATTERY_SERVICE_UUID);
      } catch {
        service = await server.getPrimaryService(BATTERY_SERVICE_UUID_HEX);
      }

      // Obtain Battery Level Characteristic (UUID 0x2A19)
      let characteristic: BleGattCharacteristic;
      try {
        characteristic = await service.getCharacteristic(
          BATTERY_LEVEL_CHARACTERISTIC_UUID,
        );
      } catch {
        characteristic = await service.getCharacteristic(
          BATTERY_LEVEL_CHARACTERISTIC_HEX,
        );
      }

      characteristicRef.current = characteristic;

      // Read initial battery level
      const initialValue = await characteristic.readValue();
      const initialLevel = parseBatteryLevel(initialValue);
      handleBatteryLevel(initialLevel, name);

      // Listen for notifications
      if (typeof characteristic.startNotifications === "function") {
        await characteristic.startNotifications();
      }

      characteristic.addEventListener(
        "characteristicvaluechanged",
        onCharacteristicValueChanged,
      );

      setIsConnected(true);
      setError(null);
    } catch (err: unknown) {
      const errMsg =
        err instanceof Error ? err.message : "Failed to connect to BLE device.";
      setError(errMsg);
      disconnect();
    } finally {
      setIsConnecting(false);
    }
  }, [
    checkIsSupported,
    requestOptions,
    handleDisconnected,
    handleBatteryLevel,
    onCharacteristicValueChanged,
    disconnect,
  ]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  return {
    batteryLevel,
    deviceName,
    deviceId,
    isConnected,
    isConnecting,
    isSupported,
    isLowBattery,
    error,
    connect,
    disconnect,
  };
}
