import { render, screen, fireEvent, act } from "@testing-library/react";
import { P2PFileShare } from "@/components/p2p/P2PFileShare";
import { useP2PFileSharing } from "@/hooks/useP2PFileSharing";

// Mock the hook to test component rendering and interaction states
jest.mock("@/hooks/useP2PFileSharing");

const mockUseP2PFileSharing = useP2PFileSharing as jest.MockedFunction<
  typeof useP2PFileSharing
>;

describe("P2PFileShare Component (#5812)", () => {
  const mockSendFile = jest.fn();
  const mockPauseTransfer = jest.fn();
  const mockResumeTransfer = jest.fn();
  const mockCancelTransfer = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    mockUseP2PFileSharing.mockReturnValue({
      peers: [
        { peerId: "peer-abc-12345678", status: "connected" },
        { peerId: "peer-xyz-87654321", status: "connecting" },
      ],
      transfers: [],
      isConnected: true,
      sendFile: mockSendFile,
      pauseTransfer: mockPauseTransfer,
      resumeTransfer: mockResumeTransfer,
      cancelTransfer: mockCancelTransfer,
    });
  });

  it("renders header, 64KB chunking badge, and connected peers", () => {
    render(<P2PFileShare roomName="test-room" />);

    expect(screen.getByTestId("p2p-file-share-container")).toBeInTheDocument();
    expect(screen.getByText("P2P Chunked File Share")).toBeInTheDocument();
    expect(screen.getByTestId("chunking-engine-badge")).toHaveTextContent(
      "64KB Slicing",
    );
    expect(screen.getByText("1 peer")).toBeInTheDocument();
  });

  it("handles file selection for files > 16MB and calculates chunk count", async () => {
    render(<P2PFileShare roomName="test-room" />);

    const fileInput = screen.getByTestId("p2p-file-input");
    // Create a mock 20MB file (20 * 1024 * 1024 bytes)
    const largeFile = new File(
      [new ArrayBuffer(1024)],
      "dataset_export.tar.gz",
      { type: "application/gzip" },
    );
    Object.defineProperty(largeFile, "size", {
      value: 20 * 1024 * 1024,
    });

    fireEvent.change(fileInput, { target: { files: [largeFile] } });

    expect(screen.getByText("dataset_export.tar.gz")).toBeInTheDocument();
    expect(screen.getByText(/20.0 MB/)).toBeInTheDocument();
    // 20MB / 64KB = 320 chunks
    expect(screen.getByText(/320 chunks/)).toBeInTheDocument();

    const sendBtn = screen.getByTestId("p2p-send-file-btn");
    expect(sendBtn).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(sendBtn);
    });

    expect(mockSendFile).toHaveBeenCalledWith(largeFile, expect.any(String));
  });

  it("displays real-time progress bar, throughput (MB/s), and ETA during transfer", () => {
    mockUseP2PFileSharing.mockReturnValue({
      peers: [{ peerId: "peer-abc-12345678", status: "connected" }],
      transfers: [
        {
          id: "transfer-1",
          fileName: "model_weights.bin",
          fileSize: 32 * 1024 * 1024, // 32MB
          mimeType: "application/octet-stream",
          progress: 45,
          bytesTransferred: 14.4 * 1024 * 1024,
          totalChunks: 512,
          currentChunk: 230,
          speedBps: 2.5 * 1024 * 1024,
          speedMBps: 2.5,
          etaSeconds: 7,
          status: "sending",
          direction: "send",
          peerId: "peer-abc-12345678",
        },
      ],
      isConnected: true,
      sendFile: mockSendFile,
      pauseTransfer: mockPauseTransfer,
      resumeTransfer: mockResumeTransfer,
      cancelTransfer: mockCancelTransfer,
    });

    render(<P2PFileShare roomName="test-room" />);

    expect(screen.getByText("model_weights.bin")).toBeInTheDocument();
    expect(
      screen.getByTestId("transfer-percentage-transfer-1"),
    ).toHaveTextContent("45%");

    const progressBar = screen.getByTestId("transfer-progress-bar-transfer-1");
    expect(progressBar).toHaveAttribute("aria-valuenow", "45");
    expect(progressBar).toHaveStyle("width: 45%");

    expect(screen.getByTestId("transfer-speed-transfer-1")).toHaveTextContent(
      "2.5 MB/s",
    );
    expect(screen.getByTestId("transfer-eta-transfer-1")).toHaveTextContent(
      "ETA: 7s",
    );
  });

  it("supports pausing, resuming, and cancelling transfers", () => {
    mockUseP2PFileSharing.mockReturnValue({
      peers: [{ peerId: "peer-abc-12345678", status: "connected" }],
      transfers: [
        {
          id: "transfer-active",
          fileName: "presentation.pdf",
          fileSize: 50 * 1024 * 1024,
          mimeType: "application/pdf",
          progress: 30,
          bytesTransferred: 15 * 1024 * 1024,
          totalChunks: 800,
          currentChunk: 240,
          speedBps: 1.8 * 1024 * 1024,
          speedMBps: 1.8,
          etaSeconds: 19,
          status: "sending",
          direction: "send",
          peerId: "peer-abc-12345678",
        },
      ],
      isConnected: true,
      sendFile: mockSendFile,
      pauseTransfer: mockPauseTransfer,
      resumeTransfer: mockResumeTransfer,
      cancelTransfer: mockCancelTransfer,
    });

    const { rerender } = render(<P2PFileShare roomName="test-room" />);

    const pauseBtn = screen.getByTestId("pause-transfer-btn-transfer-active");
    fireEvent.click(pauseBtn);
    expect(mockPauseTransfer).toHaveBeenCalledWith("transfer-active");

    const cancelBtn = screen.getByTestId("cancel-transfer-btn-transfer-active");
    fireEvent.click(cancelBtn);
    expect(mockCancelTransfer).toHaveBeenCalledWith("transfer-active");

    // Simulate paused state and resume click
    mockUseP2PFileSharing.mockReturnValue({
      peers: [{ peerId: "peer-abc-12345678", status: "connected" }],
      transfers: [
        {
          id: "transfer-active",
          fileName: "presentation.pdf",
          fileSize: 50 * 1024 * 1024,
          mimeType: "application/pdf",
          progress: 30,
          bytesTransferred: 15 * 1024 * 1024,
          totalChunks: 800,
          currentChunk: 240,
          speedBps: 0,
          speedMBps: 0,
          etaSeconds: 0,
          status: "paused",
          direction: "send",
          peerId: "peer-abc-12345678",
          isPaused: true,
        },
      ],
      isConnected: true,
      sendFile: mockSendFile,
      pauseTransfer: mockPauseTransfer,
      resumeTransfer: mockResumeTransfer,
      cancelTransfer: mockCancelTransfer,
    });

    rerender(<P2PFileShare roomName="test-room" />);

    const resumeBtn = screen.getByTestId("resume-transfer-btn-transfer-active");
    fireEvent.click(resumeBtn);
    expect(mockResumeTransfer).toHaveBeenCalledWith("transfer-active");
  });

  it("renders SHA-256 integrity verification badge and download button when complete", () => {
    mockUseP2PFileSharing.mockReturnValue({
      peers: [{ peerId: "peer-abc-12345678", status: "connected" }],
      transfers: [
        {
          id: "transfer-done",
          fileName: "database_dump.sql",
          fileSize: 45 * 1024 * 1024,
          mimeType: "application/sql",
          progress: 100,
          bytesTransferred: 45 * 1024 * 1024,
          totalChunks: 720,
          currentChunk: 720,
          speedBps: 0,
          speedMBps: 0,
          etaSeconds: 0,
          status: "complete",
          checksum:
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          actualChecksum:
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          direction: "receive",
          peerId: "peer-abc-12345678",
          blobUrl: "blob:http://localhost/sample-blob-url",
        },
      ],
      isConnected: true,
      sendFile: mockSendFile,
      pauseTransfer: mockPauseTransfer,
      resumeTransfer: mockResumeTransfer,
      cancelTransfer: mockCancelTransfer,
    });

    render(<P2PFileShare roomName="test-room" />);

    const checksumBadge = screen.getByTestId("checksum-verified-transfer-done");
    expect(checksumBadge).toHaveTextContent("SHA-256 Verified (e3b0c442...)");

    const downloadBtn = screen.getByTestId("download-file-btn-transfer-done");
    expect(downloadBtn).toHaveAttribute(
      "href",
      "blob:http://localhost/sample-blob-url",
    );
    expect(downloadBtn).toHaveAttribute("download", "database_dump.sql");
  });
});
