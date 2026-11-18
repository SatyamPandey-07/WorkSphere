import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { MeshCallGrid } from "@/components/audio/MeshCallGrid";
import { useWebRTCMesh } from "@/hooks/useWebRTCMesh";
import { useUser } from "@clerk/nextjs";

// Mock clerk useUser
jest.mock("@clerk/nextjs", () => ({
  useUser: jest.fn(() => ({
    user: {
      id: "user_local_123",
      firstName: "Sarah",
      lastName: "Connor",
      imageUrl: "https://example.com/sarah.png",
    },
  })),
}));

// Mock useWebRTCMesh
jest.mock("@/hooks/useWebRTCMesh", () => ({
  useWebRTCMesh: jest.fn(),
}));

// Mock PeerAvatarTile to verify props passed by MeshCallGrid
jest.mock("@/components/audio/PeerAvatarTile", () => ({
  PeerAvatarTile: (props: any) => (
    <div
      data-testid={`peer-tile-${props.peerId}`}
      data-name={props.name}
      data-avatar={props.avatarUrl}
      data-local={props.isLocal ? "true" : "false"}
    >
      <span>{props.name}</span>
    </div>
  ),
}));

describe("MeshCallGrid Component", () => {
  const defaultMockMesh = {
    localStream: null,
    remoteStreams: {},
    audioLevels: { local: 0.05 },
    isAudioEnabled: true,
    isVideoEnabled: true,
    isScreenSharing: false,
    error: null,
    rtt: 42,
    networkQuality: "good",
    toggleAudio: jest.fn(),
    toggleVideo: jest.fn(),
    toggleScreenShare: jest.fn(),
  };

  beforeEach(() => {
    (useWebRTCMesh as jest.Mock).mockReturnValue({ ...defaultMockMesh });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("renders join prompt initially when not joined", () => {
    render(<MeshCallGrid sessionSlug="tech-sync" />);

    expect(screen.getByTestId("mesh-call-grid-container")).toBeInTheDocument();
    expect(screen.getByTestId("mesh-call-join-prompt")).toBeInTheDocument();
    expect(screen.getByTestId("mesh-call-join-button")).toBeInTheDocument();
    expect(screen.queryByTestId("mesh-call-controls")).toBeNull();
  });

  it("joins video call and displays local user tile with avatarUrl", () => {
    const onJoin = jest.fn();
    render(<MeshCallGrid sessionSlug="tech-sync" onJoin={onJoin} />);

    fireEvent.click(screen.getByTestId("mesh-call-join-button"));

    expect(onJoin).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("mesh-call-live-badge")).toHaveTextContent("Live (1)");

    const localTile = screen.getByTestId("peer-tile-local");
    expect(localTile).toBeInTheDocument();
    expect(localTile).toHaveAttribute("data-name", "Sarah Connor");
    expect(localTile).toHaveAttribute("data-avatar", "https://example.com/sarah.png");
    expect(localTile).toHaveAttribute("data-local", "true");
  });

  it("displays waiting for peers notice when only local user is in the room", () => {
    render(<MeshCallGrid sessionSlug="tech-sync" />);

    fireEvent.click(screen.getByTestId("mesh-call-join-button"));

    expect(screen.getByTestId("mesh-call-waiting-peers")).toBeInTheDocument();
    expect(screen.getByText(/Waiting for peers to connect.../i)).toBeInTheDocument();
  });

  it("renders remote peers and hides waiting notice when remote participants connect", () => {
    const mockTrack = { enabled: true, muted: false };
    const mockRemoteStream = {
      getAudioTracks: () => [mockTrack],
    } as any;

    (useWebRTCMesh as jest.Mock).mockReturnValue({
      ...defaultMockMesh,
      remoteStreams: {
        peer_abc123: mockRemoteStream,
        peer_def456: mockRemoteStream,
      },
      audioLevels: { local: 0.05, peer_abc123: 0.25, peer_def456: 0.0 },
    });

    render(<MeshCallGrid sessionSlug="tech-sync" />);
    fireEvent.click(screen.getByTestId("mesh-call-join-button"));

    expect(screen.getByTestId("mesh-call-live-badge")).toHaveTextContent("Live (3)");
    expect(screen.getByTestId("peer-tile-local")).toBeInTheDocument();
    expect(screen.getByTestId("peer-tile-peer_abc123")).toBeInTheDocument();
    expect(screen.getByTestId("peer-tile-peer_def456")).toBeInTheDocument();

    // Waiting notice should be hidden when remote peers are present
    expect(screen.queryByTestId("mesh-call-waiting-peers")).toBeNull();
  });

  it("triggers call controls (audio, video, screen share, mute all)", () => {
    const toggleAudio = jest.fn();
    const toggleVideo = jest.fn();
    const toggleScreenShare = jest.fn();

    (useWebRTCMesh as jest.Mock).mockReturnValue({
      ...defaultMockMesh,
      toggleAudio,
      toggleVideo,
      toggleScreenShare,
    });

    render(<MeshCallGrid sessionSlug="tech-sync" />);
    fireEvent.click(screen.getByTestId("mesh-call-join-button"));

    fireEvent.click(screen.getByTestId("mesh-call-audio-toggle"));
    expect(toggleAudio).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId("mesh-call-video-toggle"));
    expect(toggleVideo).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId("mesh-call-screen-toggle"));
    expect(toggleScreenShare).toHaveBeenCalledTimes(1);

    // Mute all toggle updates local state
    const muteAllButton = screen.getByTestId("mesh-call-mute-all-toggle");
    expect(muteAllButton).toHaveTextContent("Mute All");
    fireEvent.click(muteAllButton);
    expect(muteAllButton).toHaveTextContent("Unmute All");
  });

  it("leaves call gracefully without calling reload by default", () => {
    const onLeave = jest.fn();
    const mockReload = jest.fn();

    render(
      <MeshCallGrid
        sessionSlug="tech-sync"
        onLeave={onLeave}
        onReload={mockReload}
      />
    );
    fireEvent.click(screen.getByTestId("mesh-call-join-button"));

    // In call
    expect(screen.getByTestId("mesh-call-controls")).toBeInTheDocument();

    // Leave
    fireEvent.click(screen.getByTestId("mesh-call-leave-button"));

    expect(onLeave).toHaveBeenCalledTimes(1);
    expect(mockReload).not.toHaveBeenCalled();
    expect(screen.getByTestId("mesh-call-join-prompt")).toBeInTheDocument();
  });

  it("calls onReload on leave when reloadOnLeave is explicitly enabled", () => {
    const mockReload = jest.fn();
    render(
      <MeshCallGrid
        sessionSlug="tech-sync"
        reloadOnLeave={true}
        onReload={mockReload}
      />
    );
    fireEvent.click(screen.getByTestId("mesh-call-join-button"));
    fireEvent.click(screen.getByTestId("mesh-call-leave-button"));

    expect(mockReload).toHaveBeenCalledTimes(1);
  });

  it("displays error banner when connection error occurs", () => {
    (useWebRTCMesh as jest.Mock).mockReturnValue({
      ...defaultMockMesh,
      error: "ICE connection failed to establish mesh link",
    });

    render(<MeshCallGrid sessionSlug="tech-sync" />);

    expect(screen.getByTestId("mesh-call-error-banner")).toBeInTheDocument();
    expect(screen.getByText("ICE connection failed to establish mesh link")).toBeInTheDocument();
  });
});
