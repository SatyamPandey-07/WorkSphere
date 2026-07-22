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

jest.mock("partysocket/react", () => ({
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
    stop: jest.Mock;
    onended: ((ev?: Event) => void) | null;
  };

  beforeEach(() => {
    stop.mockClear();
    send.mockClear();
    socketOpts = {};

    videoTrack = { kind: "video", stop, onended: null };

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
