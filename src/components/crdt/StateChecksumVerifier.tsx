/**
 * StateChecksumVerifier.tsx
 *
 * Verifies cryptographic SHA-256 state vector integrity checksums for collaborative CRDT sessions.
 * Compares computed local snapshot checksums against authoritative expected checksums, calculates
 * vector clock differences, triggers StateChecksumMismatchModal upon integrity failure,
 * and coordinates reconciliation workflows (Re-sync from Authority, Export Diagnostics, Force Overwrite).
 */

"use client";

import React, { useState, useCallback, useEffect, useRef } from "react";
import * as Y from "yjs";
import {
  sharedStateVectorChecksumVerifier,
  computeSha256Digest,
} from "@/lib/crdt/stateVectorChecksum";
import {
  StateChecksumMismatchModal,
  ChecksumMismatchDiagnostics,
  VectorClockDiff,
} from "./StateChecksumMismatchModal";
import {
  StoredSnapshot,
  SnapshotStorage,
  computeSnapshotChecksum,
  decompressSnapshot,
  createHttpSnapshotStorage,
} from "@/lib/crdt/snapshotManager";

export interface StateChecksumVerifierProps {
  documentId: string;
  doc?: Y.Doc;
  storage?: SnapshotStorage;
  expectedChecksum?: string;
  authorityVector?: Record<string, number>;
  onRecoveryComplete?: (action: "resync" | "overwrite") => void;
  onError?: (error: unknown) => void;
  autoVerifyIntervalMs?: number;
  canForceOverwrite?: boolean;
  children?: React.ReactNode;
}

export interface VerificationResult {
  valid: boolean;
  computedChecksum: string;
  expectedChecksum: string;
  mismatchDetected: boolean;
  error?: string;
}

/**
 * Calculates differences between two vector clocks or state vectors.
 */
export function calculateVectorClockDiffs(
  local: Record<string, number> = {},
  authority: Record<string, number> = {},
): VectorClockDiff[] {
  const diffs: VectorClockDiff[] = [];
  const allNodes = new Set([...Object.keys(local), ...Object.keys(authority)]);

  for (const nodeId of allNodes) {
    const localTime = local[nodeId] || 0;
    const authorityTime = authority[nodeId] || 0;
    if (localTime !== authorityTime) {
      diffs.push({
        nodeId,
        localTime,
        authorityTime,
        delta: localTime - authorityTime,
      });
    }
  }

  return diffs;
}

/**
 * Decodes a binary Yjs state vector into a standard Record<string, number> mapping client IDs to clocks.
 */
export function decodeYjsStateVector(vectorBytes: Uint8Array): Record<string, number> {
  const record: Record<string, number> = {};
  try {
    const decoded = Y.decodeStateVector(vectorBytes);
    decoded.forEach((clock, client) => {
      record[String(client)] = clock;
    });
  } catch {
    // If not standard Yjs state vector, return empty
  }
  return record;
}

export const StateChecksumVerifier: React.FC<StateChecksumVerifierProps> = ({
  documentId,
  doc,
  storage,
  expectedChecksum,
  authorityVector,
  onRecoveryComplete,
  onError,
  autoVerifyIntervalMs = 0,
  canForceOverwrite = true,
  children,
}) => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [diagnostics, setDiagnostics] = useState<ChecksumMismatchDiagnostics | null>(null);

  const verifierRef = useRef(sharedStateVectorChecksumVerifier);
  const activeStorageRef = useRef<SnapshotStorage>(storage || createHttpSnapshotStorage());
  const inFlightOperationRef = useRef<boolean>(false);
  const lastLoggedMismatchRef = useRef<string | null>(null);

  useEffect(() => {
    if (storage) {
      activeStorageRef.current = storage;
    }
  }, [storage]);

  /**
   * Log structured diagnostic event without exposing credentials or entire raw payloads repeatedly.
   */
  const logDiagnosticEvent = useCallback(
    (action: string, payload: Record<string, unknown>) => {
      const logPayload = {
        component: "StateChecksumVerifier",
        documentId,
        action,
        timestamp: new Date().toISOString(),
        ...payload,
      };
      if (action.includes("FAILED") || action.includes("MISMATCH")) {
        console.warn(`[StateChecksumVerifier] ${action}`, logPayload);
      } else {
        console.info(`[StateChecksumVerifier] ${action}`, logPayload);
      }
    },
    [documentId],
  );

  /**
   * Verifies the given snapshot bytes or live document against an expected SHA-256 digest.
   */
  const verifyChecksum = useCallback(
    async (
      customExpectedChecksum?: string,
      customSnapshotBytes?: Uint8Array,
    ): Promise<VerificationResult> => {
      const targetExpected = customExpectedChecksum ?? expectedChecksum;
      if (!targetExpected) {
        return {
          valid: true,
          computedChecksum: "",
          expectedChecksum: "",
          mismatchDetected: false,
        };
      }

      let snapshotBytes = customSnapshotBytes;
      if (!snapshotBytes && doc) {
        snapshotBytes = Y.encodeStateAsUpdate(doc);
      }

      if (!snapshotBytes) {
        return {
          valid: false,
          computedChecksum: "",
          expectedChecksum: targetExpected,
          mismatchDetected: false,
          error: "No CRDT snapshot or document provided for verification",
        };
      }

      try {
        const computedSha256 = await verifierRef.current.getOrComputeDigest(snapshotBytes);
        const matches = computedSha256.toLowerCase() === targetExpected.toLowerCase();

        if (!matches) {
          // Detect actual integrity failure
          let localVectorMap: Record<string, number> = {};
          if (doc) {
            try {
              const vectorBytes = Y.encodeStateVector(doc);
              localVectorMap = decodeYjsStateVector(vectorBytes);
            } catch {
              // Ignore vector decoding errors
            }
          }

          const diffs = calculateVectorClockDiffs(localVectorMap, authorityVector || {});

          // Prevent duplicate logs for the same mismatch
          const mismatchKey = `${computedSha256}_${targetExpected}`;
          if (lastLoggedMismatchRef.current !== mismatchKey) {
            lastLoggedMismatchRef.current = mismatchKey;
            logDiagnosticEvent("CHECKSUM_MISMATCH_DETECTED", {
              expectedChecksum: targetExpected,
              computedChecksum: computedSha256,
              vectorClockDiffs: diffs,
            });
          }

          const diagnosticInfo: ChecksumMismatchDiagnostics = {
            documentId,
            expectedChecksum: targetExpected,
            computedChecksum: computedSha256,
            timestamp: Date.now(),
            localVector: localVectorMap,
            authorityVector: authorityVector || {},
            vectorClockDiffs: diffs,
            rawSnapshot: snapshotBytes,
          };

          setDiagnostics(diagnosticInfo);
          setIsModalOpen(true);

          return {
            valid: false,
            computedChecksum: computedSha256,
            expectedChecksum: targetExpected,
            mismatchDetected: true,
          };
        } else {
          // Checksum matched
          lastLoggedMismatchRef.current = null;
          return {
            valid: true,
            computedChecksum: computedSha256,
            expectedChecksum: targetExpected,
            mismatchDetected: false,
          };
        }
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        logDiagnosticEvent("HASHING_EXECUTION_FAILED", { error: errorMsg });
        onError?.(err);

        return {
          valid: false,
          computedChecksum: "",
          expectedChecksum: targetExpected,
          mismatchDetected: false,
          error: errorMsg,
        };
      }
    },
    [doc, expectedChecksum, authorityVector, documentId, logDiagnosticEvent, onError],
  );

  // Trigger verification if expectedChecksum prop is provided or updated
  useEffect(() => {
    if (expectedChecksum) {
      void verifyChecksum(expectedChecksum);
    }
  }, [expectedChecksum, verifyChecksum]);

  // Optional periodic verification
  useEffect(() => {
    if (autoVerifyIntervalMs <= 0 || !expectedChecksum) return;
    const interval = setInterval(() => {
      void verifyChecksum(expectedChecksum);
    }, autoVerifyIntervalMs);
    return () => clearInterval(interval);
  }, [autoVerifyIntervalMs, expectedChecksum, verifyChecksum]);

  /**
   * Action 1: Re-sync from Authority workflow.
   */
  const handleResyncFromAuthority = useCallback(async () => {
    if (inFlightOperationRef.current) return;
    inFlightOperationRef.current = true;

    logDiagnosticEvent("RECOVERY_ACTION_STARTED", { actionType: "resync" });

    try {
      const storageInstance = activeStorageRef.current;
      const rawBaseline = await storageInstance.loadSnapshot(documentId);

      if (!rawBaseline) {
        throw new Error(`No authoritative snapshot found for document ${documentId}`);
      }

      if (rawBaseline.roomId && rawBaseline.roomId !== documentId) {
        throw new Error(
          `Document identity mismatch: received snapshot for ${rawBaseline.roomId}, expected ${documentId}`,
        );
      }

      const baseline = decompressSnapshot(rawBaseline);

      // Verify authoritative snapshot checksum
      const uncompressedChecksum = computeSnapshotChecksum(baseline.update);
      const rawChecksum = computeSnapshotChecksum(rawBaseline.update);
      const sha256Checksum = await computeSha256Digest(baseline.update);

      const isValid =
        baseline.checksum === uncompressedChecksum ||
        baseline.checksum === rawChecksum ||
        baseline.checksum.toLowerCase() === sha256Checksum.toLowerCase() ||
        (expectedChecksum && expectedChecksum.toLowerCase() === sha256Checksum.toLowerCase());

      if (!isValid) {
        throw new Error(
          `Authoritative snapshot failed integrity verification. Expected ${expectedChecksum || baseline.checksum}, computed ${sha256Checksum}`,
        );
      }

      // Apply to document through established CRDT mechanism
      if (doc) {
        Y.applyUpdate(doc, baseline.update, "authority-resync");

        // Replay any newer deltas
        const deltas = await storageInstance.listDeltas(documentId);
        for (const delta of deltas.sort((a, b) => a.seq - b.seq)) {
          Y.applyUpdate(doc, delta.update, "authority-resync");
        }
      }

      logDiagnosticEvent("RECOVERY_ACTION_SUCCESS", { actionType: "resync" });
      onRecoveryComplete?.("resync");

      // Clear divergence and close modal
      setIsModalOpen(false);
      setDiagnostics(null);
      lastLoggedMismatchRef.current = null;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logDiagnosticEvent("RECOVERY_ACTION_FAILED", {
        actionType: "resync",
        error: msg,
      });
      onError?.(err);
      throw err;
    } finally {
      inFlightOperationRef.current = false;
    }
  }, [documentId, doc, expectedChecksum, logDiagnosticEvent, onRecoveryComplete, onError]);

  /**
   * Action 3: Force Overwrite workflow.
   */
  const handleForceOverwrite = useCallback(async () => {
    if (inFlightOperationRef.current) return;
    inFlightOperationRef.current = true;

    logDiagnosticEvent("RECOVERY_ACTION_STARTED", { actionType: "force_overwrite" });

    try {
      if (!doc) {
        throw new Error("No active document instance available to overwrite authority.");
      }

      const storageInstance = activeStorageRef.current;
      const uncompressedUpdate = Y.encodeStateAsUpdate(doc);
      const uncompressedStateVector = Y.encodeStateVector(doc);
      const checksum = computeSnapshotChecksum(uncompressedUpdate);
      const sha256Checksum = await computeSha256Digest(uncompressedUpdate);

      const snapshot: StoredSnapshot = {
        roomId: documentId,
        update: uncompressedUpdate,
        stateVector: uncompressedStateVector,
        checksum: sha256Checksum || checksum,
        opsAtSnapshot: 0,
        createdAt: Date.now(),
        isCompressed: false,
        uncompressedSize: uncompressedUpdate.length,
      };

      // Save local snapshot as new authoritative baseline
      await storageInstance.saveSnapshot(snapshot);

      // Re-initialize or verify
      logDiagnosticEvent("RECOVERY_ACTION_SUCCESS", { actionType: "force_overwrite" });
      onRecoveryComplete?.("overwrite");

      // Clear divergence and close modal
      setIsModalOpen(false);
      setDiagnostics(null);
      lastLoggedMismatchRef.current = null;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logDiagnosticEvent("RECOVERY_ACTION_FAILED", {
        actionType: "force_overwrite",
        error: msg,
      });
      onError?.(err);
      throw err;
    } finally {
      inFlightOperationRef.current = false;
    }
  }, [doc, documentId, logDiagnosticEvent, onRecoveryComplete, onError]);

  return (
    <>
      {children}
      {diagnostics && (
        <StateChecksumMismatchModal
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          diagnostics={diagnostics}
          onResyncFromAuthority={handleResyncFromAuthority}
          onForceOverwrite={canForceOverwrite ? handleForceOverwrite : undefined}
          canForceOverwrite={canForceOverwrite}
        />
      )}
    </>
  );
};

export default StateChecksumVerifier;
