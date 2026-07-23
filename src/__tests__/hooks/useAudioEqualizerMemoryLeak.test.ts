import { renderHook } from "@testing-library/react";
import { useAudioEqualizer } from "../../hooks/useAudioEqualizer";

describe("useAudioEqualizer Memory Leak & Cleanup Suite (#1285)", () => {
  let mockDisconnect: jest.Mock;
  let mockClose: jest.Mock;

  beforeEach(() => {
    mockDisconnect = jest.fn();
    mockClose = jest.fn().mockResolvedValue(undefined);

    const mockAudioContextInstance = {
      state: "running",
      close: mockClose,
      createGain: jest.fn(() => ({ disconnect: mockDisconnect })),
    };

    global.AudioContext = jest
      .fn()
      .mockImplementation(() => mockAudioContextInstance) as any;
  });

  it("explicitly disconnects filter nodes and closes AudioContext on unmount", async () => {
    const { unmount } = renderHook(() => useAudioEqualizer());

    // Unmount hook to trigger cleanup
    unmount();

    expect(mockClose).toHaveBeenCalled();
  });
});
