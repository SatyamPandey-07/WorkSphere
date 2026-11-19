import React from "react";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import * as Y from "yjs";
import {
  StateChecksumVerifier,
  calculateVectorClockDiffs,
  decodeYjsStateVector,
} from "@/components/crdt/StateChecksumVerifier";
import { computeSha256Digest } from "@/lib/crdt/stateVectorChecksum";
import { SnapshotStorage, StoredSnapshot, StoredDelta } from "@/lib/crdt/snapshotManager";

class MockSnapshotStorage implements SnapshotStorage {
  public snapshot: StoredSnapshot | null = null;
  public deltas: StoredDelta[] = [];
  public savedSnapshots: StoredSnapshot[] = [];

  async saveSnapshot(snapshot: StoredSnapshot): Promise<void> {
    this.snapshot = snapshot;
    this.savedSnapshots.push(snapshot);
  }
  async loadSnapshot(_roomId: string): Promise<StoredSnapshot | null> {
    return this.snapshot;
  }
  async deleteSnapshot(_roomId: string): Promise<void> {
    this.snapshot = null;
  }
  async appendDelta(delta: StoredDelta): Promise<void> {
    this.deltas.push(delta);
  }
  async listDeltas(_roomId: string): Promise<StoredDelta[]> {
    return [...this.deltas];
  }
  async deleteDeltasThrough(_roomId: string, throughSeq: number): Promise<void> {
    this.deltas = this.deltas.filter((d) => d.seq > throughSeq);
  }
  async clearRoom(_roomId: string): Promise<void> {
    this.snapshot = null;
    this.deltas = [];
  }
}

describe("StateChecksumVerifier", () => {
  let doc: Y.Doc;
  let mockStorage: MockSnapshotStorage;

  beforeEach(() => {
    doc = new Y.Doc();
    mockStorage = new MockSnapshotStorage();
    jest.clearAllMocks();
  });

  describe("Utility functions", () => {
    it("calculateVectorClockDiffs correctly calculates clock deltas", () => {
      const local = { "node-A": 10, "node-B": 4 };
      const authority = { "node-A": 10, "node-B": 8, "node-C": 2 };

      const diffs = calculateVectorClockDiffs(local, authority);
      expect(diffs).toHaveLength(2);

      const diffB = diffs.find((d) => d.nodeId === "node-B");
      expect(diffB).toEqual({
        nodeId: "node-B",
        localTime: 4,
        authorityTime: 8,
        delta: -4,
      });

      const diffC = diffs.find((d) => d.nodeId === "node-C");
      expect(diffC).toEqual({
        nodeId: "node-C",
        localTime: 0,
        authorityTime: 2,
        delta: -2,
      });
    });

    it("decodeYjsStateVector extracts client vector map", () => {
      const yText = doc.getText("test");
      yText.insert(0, "Hello World");

      const vectorBytes = Y.encodeStateVector(doc);
      const decoded = decodeYjsStateVector(vectorBytes);

      expect(decoded[String(doc.clientID)]).toBeGreaterThan(0);
    });
  });

  describe("Checksum Verification & Modal Triggering", () => {
    it("remains closed when checksum matches", async () => {
      const yText = doc.getText("test");
      yText.insert(0, "Identical content");
      const updateBytes = Y.encodeStateAsUpdate(doc);
      const matchingHash = await computeSha256Digest(updateBytes);

      render(
        <StateChecksumVerifier
          documentId="room-101"
          doc={doc}
          storage={mockStorage}
          expectedChecksum={matchingHash}
        >
          <div data-testid="child-content">Active Canvas</div>
        </StateChecksumVerifier>,
      );

      expect(screen.getByTestId("child-content")).toBeInTheDocument();
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("triggers mismatch modal when expected checksum differs from local digest", async () => {
      const yText = doc.getText("test");
      yText.insert(0, "Local modified content");

      const differentExpectedChecksum = "0000000000000000000000000000000000000000000000000000000000000000";

      render(
        <StateChecksumVerifier
          documentId="room-101"
          doc={doc}
          storage={mockStorage}
          expectedChecksum={differentExpectedChecksum}
          authorityVector={{ "peer-server": 5 }}
        />,
      );

      await waitFor(() => {
        expect(screen.getByRole("dialog")).toBeInTheDocument();
        expect(
          screen.getByRole("heading", { name: "State Synchronization Issue Detected" }),
        ).toBeInTheDocument();
      });
    });
  });

  describe("Authority Re-sync workflow", () => {
    it("fetches authoritative snapshot, verifies checksum, applies update, and clears modal", async () => {
      // 1. Prepare remote authoritative document
      const remoteDoc = new Y.Doc();
      const remoteText = remoteDoc.getText("test");
      remoteText.insert(0, "Server Authoritative Truth");
      const remoteUpdate = Y.encodeStateAsUpdate(remoteDoc);
      const remoteStateVector = Y.encodeStateVector(remoteDoc);
      const remoteChecksum = await computeSha256Digest(remoteUpdate);

      mockStorage.snapshot = {
        roomId: "room-auth",
        update: remoteUpdate,
        stateVector: remoteStateVector,
        checksum: remoteChecksum,
        opsAtSnapshot: 1,
        createdAt: Date.now(),
      };

      // 2. Local doc with divergent content
      const localText = doc.getText("test");
      localText.insert(0, "Divergent Local Draft");

      const onRecovery = jest.fn();

      render(
        <StateChecksumVerifier
          documentId="room-auth"
          doc={doc}
          storage={mockStorage}
          expectedChecksum={remoteChecksum}
          onRecoveryComplete={onRecovery}
        />,
      );

      // Verify modal is open due to mismatch
      await waitFor(() => {
        expect(screen.getByRole("dialog")).toBeInTheDocument();
      });

      // Click Re-sync from Authority
      const resyncBtn = screen.getByRole("button", { name: /Re-sync from Authority/i });
      resyncBtn.click();

      await waitFor(() => {
        expect(onRecovery).toHaveBeenCalledWith("resync");
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      });

      // Verify local document now contains the authoritative text
      expect(localText.toString()).toContain("Server Authoritative Truth");
    });

    it("rejects authoritative snapshot from mismatched document roomId", async () => {
      mockStorage.snapshot = {
        roomId: "wrong-room",
        update: new Uint8Array([1, 2, 3]),
        stateVector: new Uint8Array([4, 5, 6]),
        checksum: "invalid-hash",
        opsAtSnapshot: 1,
        createdAt: Date.now(),
      };

      const onError = jest.fn();

      render(
        <StateChecksumVerifier
          documentId="room-expected"
          doc={doc}
          storage={mockStorage}
          expectedChecksum="some-expected-hash"
          onError={onError}
        />,
      );

      await waitFor(() => {
        expect(screen.getByRole("dialog")).toBeInTheDocument();
      });

      const resyncBtn = screen.getByRole("button", { name: /Re-sync from Authority/i });
      resyncBtn.click();

      await waitFor(() => {
        expect(onError).toHaveBeenCalled();
        expect(screen.getByText(/Document identity mismatch/i)).toBeInTheDocument();
      });
    });
  });

  describe("Force Overwrite workflow", () => {
    it("overwrites authority snapshot with local state upon confirmed action", async () => {
      const localText = doc.getText("test");
      localText.insert(0, "Local Definitive Master");

      const onRecovery = jest.fn();

      render(
        <StateChecksumVerifier
          documentId="room-force"
          doc={doc}
          storage={mockStorage}
          expectedChecksum="arbitrary-out-of-date-hash"
          onRecoveryComplete={onRecovery}
        />,
      );

      await waitFor(() => {
        expect(screen.getByRole("dialog")).toBeInTheDocument();
      });

      // Click Force Overwrite button
      const forceBtn = screen.getByRole("button", {
        name: /Force Overwrite \(Advanced & Destructive\)/i,
      });
      fireEvent.click(forceBtn);

      // Click Confirm Overwrite
      const confirmBtn = await screen.findByRole("button", { name: "Confirm Overwrite" });
      fireEvent.click(confirmBtn);

      await waitFor(() => {
        expect(onRecovery).toHaveBeenCalledWith("overwrite");
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
        expect(mockStorage.savedSnapshots.length).toBeGreaterThan(0);
      });

      const latestSaved = mockStorage.savedSnapshots[mockStorage.savedSnapshots.length - 1];
      expect(latestSaved.roomId).toBe("room-force");
      expect(latestSaved.update.length).toBeGreaterThan(0);
    });
  });
});
