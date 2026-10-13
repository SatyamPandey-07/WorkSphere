import { act, renderHook } from "@testing-library/react";
import { useScreenShare } from "@/hooks/useScreenShare";

jest.mock("@clerk/nextjs", () => ({
  useAuth: () => ({
    getToken: jest.fn().mockResolvedValue(null),
  }),
}));

const send = jest.fn();
let socketOpts: {
  onOpen?: () => void;
  onMessage?: (event: { data: string }) => void;
} = {};

jest.mock("@/hooks/usePartySocketReconnect", () => ({
  __esModule: true,
  default: jest.fn((opts: typeof socketOpts) => {
    socketOpts = opts;
    return { send };
  }),
}));

describe("useScreenShare", () => {
  const stop = jest.fn();
  let videoTrack: {
    kind: string;
    readyState: MediaStreamTrackState;
    getConstraints: jest.Mock;
    applyConstraints: jest.Mock;
    stop: jest.Mock;
    onended: ((ev?: Event) => void) | null;
  };
  const originalConstraints: MediaTrackConstraints = {
    frameRate: { ideal: 30 },
  };

  beforeEach(() => {
    stop.mockClear();
    send.mockClear();
    socketOpts = {};

    videoTrack = {
      kind: "video",
      readyState: "live",
      getConstraints: jest.fn(() => originalConstraints),
      applyConstraints: jest.fn().mockResolvedValue(undefined),
      stop,
      onended: null,
    };

    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getDisplayMedia: jest.fn().mockResolvedValue({
          getTracks: () => [videoTrack],
          getVideoTracks: () => [videoTrack],
        }),
      },
    });

    Object.defineProperty(document, "pictureInPictureEnabled", {
      configurable: true,
      value: true,
    });
  });

  it("asks for display media when the host starts sharing", async () => {
    const { result } = renderHook(() =>
      useScreenShare({
        roomId: "session-demo",
        userId: "host-1",
        isHost: true,
      }),
    );

    await act(async () => {
      await result.current.startShare();
    });

    expect(navigator.mediaDevices.getDisplayMedia).toHaveBeenCalled();
    expect(result.current.sharing).toBe(true);
    expect(send).toHaveBeenCalledWith(
      expect.stringContaining('"kind":"share-start"'),
    );
  });

  it("stops tracks when share ends", async () => {
    const { result } = renderHook(() =>
      useScreenShare({
        roomId: "session-demo",
        userId: "host-1",
        isHost: true,
      }),
    );

    await act(async () => {
      await result.current.startShare();
    });

    act(() => {
      result.current.stopShare();
    });

    expect(stop).toHaveBeenCalled();
    expect(result.current.sharing).toBe(false);
  });

  it("cleans up when the browser ends the display track", async () => {
    const { result } = renderHook(() =>
      useScreenShare({
        roomId: "session-demo",
        userId: "host-1",
        isHost: true,
      }),
    );

    await act(async () => {
      await result.current.startShare();
    });

    expect(typeof videoTrack.onended).toBe("function");

    act(() => {
      videoTrack.onended?.();
    });

    expect(send).toHaveBeenCalledWith(
      expect.stringContaining('"kind":"share-stop"'),
    );
    expect(stop).toHaveBeenCalled();
    expect(result.current.sharing).toBe(false);
  });

  it("applies Data Saver constraints and restores the original constraints", async () => {
    const { result } = renderHook(() =>
      useScreenShare({
        roomId: "session-demo",
        userId: "host-1",
        isHost: true,
      }),
    );

    await act(async () => {
      await result.current.startShare();
      await result.current.setDataSaverMode(true);
    });

    expect(videoTrack.applyConstraints).toHaveBeenNthCalledWith(1, {
      width: { ideal: 1280 },
      height: { ideal: 720 },
      frameRate: { ideal: 15 },
    });
    expect(result.current.dataSaverMode).toBe(true);

    await act(async () => {
      await result.current.setDataSaverMode(false);
    });

    expect(videoTrack.applyConstraints).toHaveBeenNthCalledWith(
      2,
      originalConstraints,
    );
    expect(result.current.dataSaverMode).toBe(false);
  });

  it("reports inactive or restricted tracks without enabling Data Saver Mode", async () => {
    const { result } = renderHook(() =>
      useScreenShare({
        roomId: "session-demo",
        userId: "host-1",
        isHost: true,
      }),
    );

    await act(async () => {
      await result.current.startShare();
    });

    videoTrack.readyState = "ended";
    await act(async () => {
      await result.current.setDataSaverMode(true);
    });

    expect(videoTrack.applyConstraints).not.toHaveBeenCalled();
    expect(result.current.dataSaverMode).toBe(false);
    expect(result.current.error).toMatch(/active screen-share video track/i);

    videoTrack.readyState = "live";
    videoTrack.applyConstraints.mockRejectedValueOnce(
      new Error("constraint is not supported"),
    );
    await act(async () => {
      await result.current.setDataSaverMode(true);
    });

    expect(result.current.dataSaverMode).toBe(false);
    expect(result.current.error).toMatch(/could not be applied/i);
  });

  it("viewers reply viewer-ready when the host starts sharing", async () => {
    renderHook(() =>
      useScreenShare({
        roomId: "session-demo",
        userId: "viewer-1",
        isHost: false,
      }),
    );

    await act(async () => {
      socketOpts.onMessage?.({
        data: JSON.stringify({
          type: "webrtc-signal",
          kind: "share-start",
          from: "host-1",
        }),
      });
    });

    expect(send).toHaveBeenCalledWith(
      expect.stringContaining('"kind":"viewer-ready"'),
    );
  });

  it("toggles picture-in-picture on the video element", async () => {
    const requestPictureInPicture = jest.fn().mockResolvedValue(undefined);
    const video = {
      requestPictureInPicture,
    } as unknown as HTMLVideoElement;

    Object.defineProperty(document, "pictureInPictureElement", {
      configurable: true,
      value: null,
    });

    const { result } = renderHook(() =>
      useScreenShare({
        roomId: "session-demo",
        userId: "host-1",
        isHost: true,
      }),
    );

    let pip = false;
    await act(async () => {
      pip = await result.current.requestPip(video);
    });

    expect(requestPictureInPicture).toHaveBeenCalled();
    expect(pip).toBe(true);
  });
});
