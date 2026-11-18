import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import {
  StateChecksumMismatchModal,
  ChecksumMismatchDiagnostics,
} from "@/components/crdt/StateChecksumMismatchModal";

describe("StateChecksumMismatchModal Component", () => {
  const baseDiagnostics: ChecksumMismatchDiagnostics = {
    documentId: "doc-room-42",
    expectedChecksum: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    computedChecksum: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    timestamp: 1700000000000,
    localVector: { "peer-1": 10, "peer-2": 5 },
    authorityVector: { "peer-1": 10, "peer-2": 8, "peer-3": 2 },
    vectorClockDiffs: [
      { nodeId: "peer-2", localTime: 5, authorityTime: 8, delta: -3 },
      { nodeId: "peer-3", localTime: 0, authorityTime: 2, delta: -2 },
    ],
    rawSnapshot: new Uint8Array([1, 2, 3, 4]),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders nothing when isOpen is false", () => {
    const { container } = render(
      <StateChecksumMismatchModal
        isOpen={false}
        onClose={jest.fn()}
        diagnostics={baseDiagnostics}
        onResyncFromAuthority={jest.fn()}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders modal with heading and non-technical explanation when isOpen is true", () => {
    render(
      <StateChecksumMismatchModal
        isOpen={true}
        onClose={jest.fn()}
        diagnostics={baseDiagnostics}
        onResyncFromAuthority={jest.fn()}
      />,
    );

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "State Synchronization Issue Detected" }),
    ).toBeInTheDocument();
    expect(screen.getByText("doc-room-42")).toBeInTheDocument();
    expect(
      screen.getByText(/The collaborative state on your device differs from the verified shared state/),
    ).toBeInTheDocument();
  });

  it("toggles technical trace section on click", () => {
    render(
      <StateChecksumMismatchModal
        isOpen={true}
        onClose={jest.fn()}
        diagnostics={baseDiagnostics}
        onResyncFromAuthority={jest.fn()}
      />,
    );

    const toggleButton = screen.getByRole("button", {
      name: /Technical Diagnostics Trace/i,
    });
    expect(screen.queryByText(/Expected SHA-256 \(Authority\):/)).not.toBeInTheDocument();

    fireEvent.click(toggleButton);
    expect(screen.getByText(/Expected SHA-256 \(Authority\):/)).toBeInTheDocument();
    expect(screen.getByText(baseDiagnostics.expectedChecksum)).toBeInTheDocument();
    expect(screen.getByText(baseDiagnostics.computedChecksum)).toBeInTheDocument();
    expect(screen.getByText(/Diverged Peers:/)).toBeInTheDocument();
    expect(screen.getByText("peer-2")).toBeInTheDocument();

    // Collapse again
    fireEvent.click(toggleButton);
    expect(screen.queryByText(/Expected SHA-256 \(Authority\):/)).not.toBeInTheDocument();
  });

  it("calls onClose when close button is clicked", () => {
    const onClose = jest.fn();
    render(
      <StateChecksumMismatchModal
        isOpen={true}
        onClose={onClose}
        diagnostics={baseDiagnostics}
        onResyncFromAuthority={jest.fn()}
      />,
    );

    const closeBtn = screen.getByRole("button", { name: "Close modal" });
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when Escape key is pressed", () => {
    const onClose = jest.fn();
    render(
      <StateChecksumMismatchModal
        isOpen={true}
        onClose={onClose}
        diagnostics={baseDiagnostics}
        onResyncFromAuthority={jest.fn()}
      />,
    );

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("dispatches onResyncFromAuthority when Re-sync button is clicked", async () => {
    const onResync = jest.fn().mockResolvedValue(undefined);
    render(
      <StateChecksumMismatchModal
        isOpen={true}
        onClose={jest.fn()}
        diagnostics={baseDiagnostics}
        onResyncFromAuthority={onResync}
      />,
    );

    const resyncBtn = screen.getByRole("button", { name: /Re-sync from Authority/i });
    fireEvent.click(resyncBtn);

    expect(onResync).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(
        screen.getByText("Document successfully re-synchronized from authority."),
      ).toBeInTheDocument();
    });
  });

  it("displays error feedback when onResyncFromAuthority rejects", async () => {
    const onResync = jest.fn().mockRejectedValue(new Error("Network snapshot fetch timed out"));
    render(
      <StateChecksumMismatchModal
        isOpen={true}
        onClose={jest.fn()}
        diagnostics={baseDiagnostics}
        onResyncFromAuthority={onResync}
      />,
    );

    const resyncBtn = screen.getByRole("button", { name: /Re-sync from Authority/i });
    fireEvent.click(resyncBtn);

    await waitFor(() => {
      expect(screen.getByText("Network snapshot fetch timed out")).toBeInTheDocument();
    });
  });

  it("dispatches custom onExportSnapshot when provided", () => {
    const onExport = jest.fn();
    render(
      <StateChecksumMismatchModal
        isOpen={true}
        onClose={jest.fn()}
        diagnostics={baseDiagnostics}
        onResyncFromAuthority={jest.fn()}
        onExportSnapshot={onExport}
      />,
    );

    const exportBtn = screen.getByRole("button", {
      name: /Export Local Snapshot for Diagnostics/i,
    });
    fireEvent.click(exportBtn);

    expect(onExport).toHaveBeenCalledTimes(1);
    expect(onExport).toHaveBeenCalledWith(baseDiagnostics);
  });

  it("requires explicit confirmation before dispatching Force Overwrite", async () => {
    const onOverwrite = jest.fn().mockResolvedValue(undefined);
    render(
      <StateChecksumMismatchModal
        isOpen={true}
        onClose={jest.fn()}
        diagnostics={baseDiagnostics}
        onResyncFromAuthority={jest.fn()}
        onForceOverwrite={onOverwrite}
      />,
    );

    const forceBtn = screen.getByRole("button", {
      name: /Force Overwrite \(Advanced & Destructive\)/i,
    });
    fireEvent.click(forceBtn);

    // Confirmation view should be displayed
    expect(screen.getByText("Confirm Destructive Overwrite")).toBeInTheDocument();
    expect(onOverwrite).not.toHaveBeenCalled();

    // Cancel leaves state unchanged
    const cancelBtn = screen.getByRole("button", { name: "Cancel" });
    fireEvent.click(cancelBtn);
    expect(screen.queryByText("Confirm Destructive Overwrite")).not.toBeInTheDocument();
    expect(onOverwrite).not.toHaveBeenCalled();

    // Open confirmation again and confirm
    fireEvent.click(
      screen.getByRole("button", {
        name: /Force Overwrite \(Advanced & Destructive\)/i,
      }),
    );
    const confirmBtn = screen.getByRole("button", { name: "Confirm Overwrite" });
    fireEvent.click(confirmBtn);

    expect(onOverwrite).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(
        screen.getByText("Authoritative state overwritten with local snapshot."),
      ).toBeInTheDocument();
    });
  });

  it("handles clipboard copy for hash checksums", async () => {
    const writeTextMock = jest.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: {
        writeText: writeTextMock,
      },
    });

    render(
      <StateChecksumMismatchModal
        isOpen={true}
        onClose={jest.fn()}
        diagnostics={baseDiagnostics}
        onResyncFromAuthority={jest.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Technical Diagnostics Trace/i }));

    const copyExpectedBtn = screen.getByTitle("Copy expected checksum");
    fireEvent.click(copyExpectedBtn);

    expect(writeTextMock).toHaveBeenCalledWith(baseDiagnostics.expectedChecksum);
  });
});
