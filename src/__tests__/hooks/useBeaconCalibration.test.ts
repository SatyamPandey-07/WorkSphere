import { act, renderHook } from "@testing-library/react";
import { useBeaconCalibration } from "@/hooks/useBeaconCalibration";

describe("useBeaconCalibration", () => {
  const requestDevice = jest.fn();
  const addEventListener = jest.fn();
  const removeEventListener = jest.fn();
  const watchAdvertisements = jest.fn();
  const unwatchAdvertisements = jest.fn();
  let advertisementListener: EventListener | undefined;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    advertisementListener = undefined;
    addEventListener.mockImplementation(
      (_event: string, listener: EventListener) => {
        advertisementListener = listener;
      },
    );
    removeEventListener.mockImplementation(() => {
      advertisementListener = undefined;
    });
    watchAdvertisements.mockResolvedValue(undefined);
    unwatchAdvertisements.mockResolvedValue(undefined);
    requestDevice.mockResolvedValue({
      addEventListener,
      removeEventListener,
      watchAdvertisements,
      unwatchAdvertisements,
    });
    Object.defineProperty(navigator, "bluetooth", {
      configurable: true,
      value: { requestDevice },
    });
  });

  afterEach(() => {
    jest.useRealTimers();
    Reflect.deleteProperty(navigator, "bluetooth");
  });

  it("collects two ten-second samples and updates calibration state after saving", async () => {
    const onSave = jest.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useBeaconCalibration(onSave));

    await act(async () => {
      await result.current.startCalibration(1, 3);
    });

    expect(result.current.phase).toBe("sampling");
    expect(result.current.activeSample).toBe(1);
    expect(result.current.secondsRemaining).toBe(10);

    const dispatchRssi = (rssi: number) => {
      const event = new Event("advertisementreceived");
      Object.defineProperty(event, "rssi", { value: rssi });
      act(() => advertisementListener?.(event));
    };

    dispatchRssi(-50);
    dispatchRssi(-52);
    act(() => jest.advanceTimersByTime(10_000));
    expect(result.current.activeSample).toBe(2);
    dispatchRssi(-59);
    dispatchRssi(-61);

    await act(async () => {
      jest.advanceTimersByTime(10_000);
      await Promise.resolve();
    });

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        referenceRssi: -51,
        pathLossExponent: expect.closeTo(10 / (10 * Math.log10(3))),
        firstMeanRssi: -51,
        secondMeanRssi: -60,
      }),
    );
    expect(result.current.phase).toBe("complete");
    expect(result.current.calibration?.referenceRssi).toBe(-51);
    expect(result.current.calibration?.firstStandardDeviation).toBe(1);
  });
});
