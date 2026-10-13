import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { MicCalibrationWizard } from "@/components/noise/MicCalibrationWizard";

// Mock Web Audio API
class MockAudioContext {
  state = "running";
  resume = jest.fn().mockResolvedValue(undefined);
  close = jest.fn().mockResolvedValue(undefined);
  createMediaStreamSource = jest.fn().mockReturnValue({
    connect: jest.fn(),
  });
  createAnalyser = jest.fn().mockReturnValue({
    fftSize: 512,
    smoothingTimeConstant: 0.3,
    frequencyBinCount: 256,
    getFloatTimeDomainData: jest.fn((buffer: Float32Array) => {
      buffer.fill(0.01);
    }),
    getFloatFrequencyData: jest.fn((buffer: Float32Array) => {
      buffer.fill(-50);
    }),
  });
}

beforeAll(() => {
  (window as unknown as { AudioContext: typeof MockAudioContext }).AudioContext = MockAudioContext;
  (window as unknown as { webkitAudioContext: typeof MockAudioContext }).webkitAudioContext = MockAudioContext;
});

describe("MicCalibrationWizard Device Selector", () => {
  const mockDevices: MediaDeviceInfo[] = [
    {
      deviceId: "default-mic",
      groupId: "group-1",
      kind: "audioinput",
      label: "Internal Laptop Microphone",
      toJSON: () => ({}),
    },
    {
      deviceId: "usb-headset-mic",
      groupId: "group-2",
      kind: "audioinput",
      label: "USB Studio Microphone",
      toJSON: () => ({}),
    },
    {
      deviceId: "video-cam",
      groupId: "group-3",
      kind: "videoinput",
      label: "Webcam HD",
      toJSON: () => ({}),
    },
  ];

  let getUserMediaMock: jest.Mock;
  let enumerateDevicesMock: jest.Mock;

  beforeEach(() => {
    getUserMediaMock = jest.fn().mockResolvedValue({
      getTracks: () => [
        {
          stop: jest.fn(),
          label: "Internal Laptop Microphone",
        },
      ],
      getAudioTracks: () => [
        {
          stop: jest.fn(),
          label: "Internal Laptop Microphone",
        },
      ],
    });

    enumerateDevicesMock = jest.fn().mockResolvedValue(mockDevices);

    Object.defineProperty(navigator, "mediaDevices", {
      value: {
        getUserMedia: getUserMediaMock,
        enumerateDevices: enumerateDevicesMock,
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
      },
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("enumerates audio input devices and renders select dropdown in Step 1", async () => {
    render(<MicCalibrationWizard isOpen={true} onClose={jest.fn()} />);

    await waitFor(() => {
      expect(enumerateDevicesMock).toHaveBeenCalled();
    });

    // Check device selector dropdown exists
    const select = await screen.findByLabelText(/Select audio input device/i);
    expect(select).toBeInTheDocument();

    // Verify only audioinput devices are rendered
    expect(screen.getByText("Internal Laptop Microphone")).toBeInTheDocument();
    expect(screen.getByText("USB Studio Microphone")).toBeInTheDocument();
    expect(screen.queryByText("Webcam HD")).not.toBeInTheDocument();
  });

  it("updates selected device and applies deviceId constraints on stream start", async () => {
    render(<MicCalibrationWizard isOpen={true} onClose={jest.fn()} />);

    const select = await screen.findByLabelText(/Select audio input device/i);
    expect(select).toBeInTheDocument();

    // Change device to USB Studio Microphone
    fireEvent.change(select, { target: { value: "usb-headset-mic" } });
    expect((select as HTMLSelectElement).value).toBe("usb-headset-mic");

    // Move to step 2 and start mic test
    const step2Button = screen.getByText(/Live Test/i);
    fireEvent.click(step2Button);

    const startButton = await screen.findByText(/Start Mic Test/i);
    fireEvent.click(startButton);

    await waitFor(() => {
      expect(getUserMediaMock).toHaveBeenCalledWith(
        expect.objectContaining({
          audio: expect.objectContaining({
            deviceId: { exact: "usb-headset-mic" },
          }),
        }),
      );
    });
  });

  it("switches active audio stream dynamically when user selects a different mic while listening", async () => {
    render(<MicCalibrationWizard isOpen={true} onClose={jest.fn()} />);

    // Go to step 2 and start stream
    const step2Button = screen.getByText(/Live Test/i);
    fireEvent.click(step2Button);

    const startButton = await screen.findByText(/Start Mic Test/i);
    fireEvent.click(startButton);

    await waitFor(() => {
      expect(getUserMediaMock).toHaveBeenCalled();
    });

    const step2Select = await screen.findByLabelText(/Select audio input device live/i);
    expect(step2Select).toBeInTheDocument();

    // Switch device live
    fireEvent.change(step2Select, { target: { value: "usb-headset-mic" } });

    await waitFor(() => {
      expect(getUserMediaMock).toHaveBeenLastCalledWith(
        expect.objectContaining({
          audio: expect.objectContaining({
            deviceId: { exact: "usb-headset-mic" },
          }),
        }),
      );
    });
  });
});
