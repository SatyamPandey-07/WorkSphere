import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import DefaultScreenSharePanel, {
  ScreenSharePanel,
  type ScreenSharePanelProps,
} from "@/components/sessions/ScreenSharePanel";
import { useScreenShare } from "@/hooks/useScreenShare";
import { useScreenShareQuality } from "@/hooks/useScreenShareQuality";

jest.mock("@/hooks/useScreenShare");
jest.mock("@/hooks/useScreenShareQuality");
jest.mock("@/components/sessions/DataSaverToggle", () => ({
  DataSaverToggle: ({
    enabled,
    onChange,
  }: {
    enabled: boolean;
    onChange: (v: boolean) => void;
  }) => (
    <button
      type="button"
      data-testid="data-saver-toggle"
      onClick={() => onChange(!enabled)}
    >
      DataSaver:{enabled ? "on" : "off"}
    </button>
  ),
}));

const mockUseScreenShare = useScreenShare as jest.MockedFunction<
  typeof useScreenShare
>;
const mockUseScreenShareQuality = useScreenShareQuality as jest.MockedFunction<
  typeof useScreenShareQuality
>;

describe("ScreenSharePanel Component (#7133)", () => {
  const defaultScreenShareReturn = {
    sharing: false,
    localStream: null,
    remoteStream: null,
    sender: null,
    error: null,
    pipSupported: true,
    dataSaverMode: false,
    startShare: jest.fn(),
    stopShare: jest.fn(),
    setDataSaverMode: jest.fn(),
    requestPip: jest.fn(),
  };

  const defaultQualityReturn = {
    currentProfile: "1080p",
    manualSetProfile: jest.fn(),
  };

  const defaultProps: ScreenSharePanelProps = {
    sessionSlug: "react-workshop",
    hostId: "user_host_1",
    currentUserId: "user_viewer_2",
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockUseScreenShare.mockReturnValue({ ...defaultScreenShareReturn });
    mockUseScreenShareQuality.mockReturnValue({ ...defaultQualityReturn });
  });

  it("exports named and default components identically", () => {
    expect(ScreenSharePanel).toBeDefined();
    expect(DefaultScreenSharePanel).toBe(ScreenSharePanel);
  });

  it("returns null when currentUserId is null or undefined (signed out)", () => {
    const { container: c1 } = render(
      <ScreenSharePanel {...defaultProps} currentUserId={null} />,
    );
    expect(c1.firstChild).toBeNull();

    const { container: c2 } = render(
      <ScreenSharePanel {...defaultProps} currentUserId={undefined} />,
    );
    expect(c2.firstChild).toBeNull();
  });

  it("renders host copy and share screen button when current user is host", () => {
    render(<ScreenSharePanel {...defaultProps} currentUserId="user_host_1" />);

    expect(
      screen.getByText("Share your screen with everyone in this session."),
    ).toBeInTheDocument();
    expect(screen.getByTestId("start-share-button")).toBeInTheDocument();
  });

  it("renders viewer waiting copy when current user is viewer and no stream is active", () => {
    render(
      <ScreenSharePanel {...defaultProps} currentUserId="user_viewer_2" />,
    );

    expect(
      screen.getByText("Waiting for the host to share their screen."),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("start-share-button")).not.toBeInTheDocument();
  });

  it("renders viewer active copy when remote stream is active", () => {
    const fakeStream = {} as MediaStream;
    mockUseScreenShare.mockReturnValue({
      ...defaultScreenShareReturn,
      remoteStream: fakeStream,
    });

    render(
      <ScreenSharePanel {...defaultProps} currentUserId="user_viewer_2" />,
    );

    expect(
      screen.getByText(
        "Host is presenting — open PiP to keep watching while you work.",
      ),
    ).toBeInTheDocument();
  });

  it("calls startShare when host clicks Share Screen button", () => {
    const mockStartShare = jest.fn();
    mockUseScreenShare.mockReturnValue({
      ...defaultScreenShareReturn,
      startShare: mockStartShare,
    });

    render(<ScreenSharePanel {...defaultProps} currentUserId="user_host_1" />);

    fireEvent.click(screen.getByTestId("start-share-button"));
    expect(mockStartShare).toHaveBeenCalledTimes(1);
  });

  it("calls stopShare and toggles data saver when host is currently sharing", () => {
    const mockStopShare = jest.fn();
    const mockSetDataSaver = jest.fn();
    const fakeStream = {} as MediaStream;

    mockUseScreenShare.mockReturnValue({
      ...defaultScreenShareReturn,
      sharing: true,
      localStream: fakeStream,
      stopShare: mockStopShare,
      setDataSaverMode: mockSetDataSaver,
    });

    render(<ScreenSharePanel {...defaultProps} currentUserId="user_host_1" />);

    expect(screen.getByTestId("stop-share-button")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("stop-share-button"));
    expect(mockStopShare).toHaveBeenCalledTimes(1);

    expect(screen.getByTestId("data-saver-toggle")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("data-saver-toggle"));
    expect(mockSetDataSaver).toHaveBeenCalledWith(true);
  });

  it("renders stage and overlay controls when host is sharing, and changes quality profile", () => {
    const mockManualSetProfile = jest.fn();
    const fakeStream = {} as MediaStream;

    mockUseScreenShare.mockReturnValue({
      ...defaultScreenShareReturn,
      sharing: true,
      localStream: fakeStream,
    });
    mockUseScreenShareQuality.mockReturnValue({
      currentProfile: "1080p",
      manualSetProfile: mockManualSetProfile,
    });

    render(<ScreenSharePanel {...defaultProps} currentUserId="user_host_1" />);

    expect(screen.getByTestId("screen-share-stage")).toBeInTheDocument();
    expect(screen.getByTestId("screen-share-video")).toBeInTheDocument();

    const overlay = screen.getByTestId("screen-share-overlay-controls");
    expect(overlay).toHaveClass("group-focus-within:opacity-100");
    expect(overlay).toHaveClass("focus-within:opacity-100");
    expect(overlay).toHaveClass("[@media(hover:none)]:opacity-100");

    const qualitySelect = screen.getByTestId("quality-select");
    expect(qualitySelect).toHaveAttribute(
      "aria-label",
      "Screen share quality profile",
    );
    fireEvent.change(qualitySelect, { target: { value: "4k" } });
    expect(mockManualSetProfile).toHaveBeenCalledWith("4k");

    const cropBtn = screen.getByTestId("crop-button");
    expect(cropBtn).toHaveAttribute("type", "button");
  });

  it("hides stage when viewer clicks Hide Stage and restores it when clicking Show Stage", () => {
    const fakeStream = {} as MediaStream;

    mockUseScreenShare.mockReturnValue({
      ...defaultScreenShareReturn,
      remoteStream: fakeStream,
    });

    render(
      <ScreenSharePanel {...defaultProps} currentUserId="user_viewer_2" />,
    );

    // Initially stage is visible
    const stage = screen.getByTestId("screen-share-stage");
    expect(stage).not.toHaveClass("hidden");
    const hideBtn = screen.getByTestId("hide-stage-button");
    expect(hideBtn).toHaveAttribute("type", "button");

    // Click Hide Stage
    fireEvent.click(hideBtn);

    // Stage is now collapsed/hidden
    expect(stage).toHaveClass("hidden");

    // Show Stage button appears in header
    const showBtn = screen.getByTestId("show-stage-button");
    expect(showBtn).toHaveAttribute("type", "button");

    // Click Show Stage
    fireEvent.click(showBtn);

    // Stage is visible again
    expect(screen.getByTestId("screen-share-stage")).not.toHaveClass("hidden");
    expect(screen.queryByTestId("show-stage-button")).not.toBeInTheDocument();
  });

  it("keeps the same video element and its stream across Hide and Show Stage", () => {
    const fakeStream = { id: "remote-stream" } as unknown as MediaStream;
    mockUseScreenShare.mockReturnValue({
      ...defaultScreenShareReturn,
      remoteStream: fakeStream,
    });

    render(
      <ScreenSharePanel {...defaultProps} currentUserId="user_viewer_2" />,
    );

    const video = screen.getByTestId("screen-share-video") as HTMLVideoElement;
    expect(video.srcObject).toBe(fakeStream);

    fireEvent.click(screen.getByTestId("hide-stage-button"));
    fireEvent.click(screen.getByTestId("show-stage-button"));

    const restoredVideo = screen.getByTestId(
      "screen-share-video",
    ) as HTMLVideoElement;
    expect(restoredVideo).toBe(video);
    expect(restoredVideo.srcObject).toBe(fakeStream);
  });

  it("keeps the PiP control available while the stage is hidden", () => {
    mockUseScreenShare.mockReturnValue({
      ...defaultScreenShareReturn,
      remoteStream: {} as MediaStream,
      pipSupported: true,
    });

    render(
      <ScreenSharePanel {...defaultProps} currentUserId="user_viewer_2" />,
    );

    fireEvent.click(screen.getByTestId("hide-stage-button"));
    expect(screen.getByTestId("pip-button")).toBeInTheDocument();
  });

  it("toggles picture-in-picture mode when Pop out button is clicked", async () => {
    const fakeStream = {} as MediaStream;
    mockUseScreenShare.mockReturnValue({
      ...defaultScreenShareReturn,
      remoteStream: fakeStream,
      pipSupported: true,
    });

    const mockRequestPip = jest.fn().mockResolvedValue({});
    Object.defineProperty(
      HTMLVideoElement.prototype,
      "requestPictureInPicture",
      {
        configurable: true,
        value: mockRequestPip,
      },
    );

    render(
      <ScreenSharePanel {...defaultProps} currentUserId="user_viewer_2" />,
    );

    const pipBtn = screen.getByTestId("pip-button");
    expect(pipBtn).toHaveTextContent("Pop out");

    fireEvent.click(pipBtn);
    await waitFor(() => {
      expect(mockRequestPip).toHaveBeenCalled();
    });
  });

  it("renders error message when error is present", () => {
    mockUseScreenShare.mockReturnValue({
      ...defaultScreenShareReturn,
      error: "Permission denied for screen capture",
    });

    render(<ScreenSharePanel {...defaultProps} currentUserId="user_host_1" />);

    expect(screen.getByTestId("screen-share-error")).toHaveTextContent(
      "Permission denied for screen capture",
    );
  });

  it("merges custom className and data-testid via cn utility", () => {
    render(
      <ScreenSharePanel
        {...defaultProps}
        className="custom-panel-class shadow-lg"
        data-testid="custom-screen-share"
      />,
    );

    const panel = screen.getByTestId("custom-screen-share");
    expect(panel).toBeInTheDocument();
    expect(panel).toHaveClass("custom-panel-class");
    expect(panel).toHaveClass("shadow-lg");
  });
});
