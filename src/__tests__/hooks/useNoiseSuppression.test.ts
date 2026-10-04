import { renderHook, act } from "@testing-library/react";
import { useNoiseSuppression } from "@/hooks/useNoiseSuppression";

function makeTrack(
  noiseSuppression = false,
  supportsConstraint = true,
): Partial<MediaStreamTrack> {
  return {
    getCapabilities: () =>
      ({ noiseSuppression: supportsConstraint } as unknown as MediaTrackCapabilities),
    getSettings: () =>
      ({ noiseSuppression } as unknown as MediaTrackSettings),
    applyConstraints: jest.fn().mockResolvedValue(undefined),
  };
}

describe("useNoiseSuppression", () => {
  it("returns isEnabled=false and isSupported=false when track is null", async () => {
    const { result } = renderHook(() =>
      useNoiseSuppression({ track: null }),
    );
    expect(result.current.isEnabled).toBe(false);
    expect(result.current.isSupported).toBe(false);
  });

  it("detects isSupported from track.getCapabilities", async () => {
    const track = makeTrack(false, true) as MediaStreamTrack;
    const { result } = renderHook(() =>
      useNoiseSuppression({ track }),
    );
    expect(result.current.isSupported).toBe(true);
  });

  it("reads initial isEnabled from track.getSettings", async () => {
    const track = makeTrack(true, true) as MediaStreamTrack;
    const { result } = renderHook(() =>
      useNoiseSuppression({ track }),
    );
    expect(result.current.isEnabled).toBe(true);
  });

  it("enable calls applyConstraints with noiseSuppression=true", async () => {
    const track = makeTrack(false, true) as MediaStreamTrack;
    const { result } = renderHook(() =>
      useNoiseSuppression({ track }),
    );

    await act(async () => {
      await result.current.enable();
    });

    expect(track.applyConstraints).toHaveBeenCalledWith({
      noiseSuppression: true,
    });
    expect(result.current.isEnabled).toBe(true);
  });

  it("disable calls applyConstraints with noiseSuppression=false", async () => {
    const track = makeTrack(true, true) as MediaStreamTrack;
    const { result } = renderHook(() =>
      useNoiseSuppression({ track }),
    );

    await act(async () => {
      await result.current.disable();
    });

    expect(track.applyConstraints).toHaveBeenCalledWith({
      noiseSuppression: false,
    });
    expect(result.current.isEnabled).toBe(false);
  });

  it("toggle flips isEnabled from false to true", async () => {
    const track = makeTrack(false, true) as MediaStreamTrack;
    const { result } = renderHook(() =>
      useNoiseSuppression({ track }),
    );

    await act(async () => {
      result.current.toggle();
    });

    expect(track.applyConstraints).toHaveBeenCalledWith({
      noiseSuppression: true,
    });
  });

  it("does not throw when applyConstraints rejects", async () => {
    const track = {
      ...makeTrack(false, true),
      applyConstraints: jest.fn().mockRejectedValue(new Error("Not supported")),
    } as unknown as MediaStreamTrack;

    const { result } = renderHook(() =>
      useNoiseSuppression({ track }),
    );

    await expect(
      act(async () => {
        await result.current.enable();
      }),
    ).resolves.not.toThrow();
  });
});
