import { act, renderHook } from "@testing-library/react";
import { useScreenShare } from "@/hooks/useScreenShare";

jest.mock("@clerk/nextjs", () => ({
  useAuth: () => ({
    getToken: jest.fn().mockResolvedValue(null),
  }),
}));

const send = jest.fn();

jest.mock("partysocket/react", () => ({
  __esModule: true,
  default: jest.fn(() => ({ send })),
}));

describe("useScreenShare", () => {
  const stop = jest.fn();

  beforeEach(() => {
    stop.mockClear();
    send.mockClear();

    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getDisplayMedia: jest.fn().mockResolvedValue({
          getTracks: () => [{ kind: "video", stop, onended: null }],
          getVideoTracks: () => [{ kind: "video", stop, onended: null }],
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
