/**
 * @jest-environment node
 */
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  runCli,
  verifySnapshotManifest,
} from "../../../scripts/verify-snapshot-manifest";

describe("verifySnapshotManifest", () => {
  let root: string;
  let chunksDirectory: string;
  let manifestPath: string;

  const sha256 = (contents: Buffer | string): string =>
    createHash("sha256").update(contents).digest("hex");

  const writeManifest = (lines: string): void => {
    writeFileSync(manifestPath, lines);
  };

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "snapshot-manifest-"));
    chunksDirectory = path.join(root, "chunks");
    mkdirSync(chunksDirectory);
    manifestPath = path.join(root, "SHA256SUMS");
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    jest.restoreAllMocks();
  });

  it("verifies valid text and binary SHA256SUMS entries", () => {
    const firstChunk = Buffer.from("partition chunk one");
    const secondChunk = Buffer.from("partition chunk two");
    writeFileSync(path.join(chunksDirectory, "chunk-000.bin"), firstChunk);
    writeFileSync(path.join(chunksDirectory, "chunk-001.bin"), secondChunk);
    writeManifest(
      `${sha256(firstChunk)}  chunk-000.bin\n${sha256(secondChunk)} *chunk-001.bin\n`,
    );

    const report = verifySnapshotManifest(manifestPath, chunksDirectory);

    expect(report.status).toBe("VALID");
    expect(report.totalChunks).toBe(2);
    expect(report.validChunks).toBe(2);
    expect(report.chunks).toEqual([
      expect.objectContaining({
        fileName: "chunk-000.bin",
        expectedHash: sha256(firstChunk),
        actualHash: sha256(firstChunk),
        status: "VALID",
      }),
      expect.objectContaining({
        fileName: "chunk-001.bin",
        expectedHash: sha256(secondChunk),
        actualHash: sha256(secondChunk),
        status: "VALID",
      }),
    ]);
  });

  it("reports missing chunks", () => {
    const expectedHash = sha256("expected contents");
    writeManifest(`${expectedHash}  missing.bin\n`);

    const report = verifySnapshotManifest(manifestPath, chunksDirectory);

    expect(report.status).toBe("FAILED");
    expect(report.chunks[0]).toMatchObject({
      fileName: "missing.bin",
      expectedHash,
      status: "MISSING",
      errorMessage: "Chunk file is missing",
    });
  });

  it("reports corrupted or tampered chunks as SHA-256 mismatches", () => {
    writeFileSync(path.join(chunksDirectory, "chunk.bin"), "modified contents");
    writeManifest(`${sha256("original contents")}  chunk.bin\n`);

    const report = verifySnapshotManifest(manifestPath, chunksDirectory);

    expect(report.status).toBe("FAILED");
    expect(report.chunks[0]).toMatchObject({
      expectedHash: sha256("original contents"),
      actualHash: sha256("modified contents"),
      status: "HASH_MISMATCH",
    });
    expect(report.chunks[0].errorMessage).toMatch(/SHA-256 mismatch/);
  });

  it("detects truncated chunks through their hash mismatch", () => {
    const original = Buffer.from("complete partition chunk");
    const truncated = original.subarray(0, original.length - 4);
    writeFileSync(path.join(chunksDirectory, "chunk.bin"), truncated);
    writeManifest(`${sha256(original)}  chunk.bin\n`);

    const report = verifySnapshotManifest(manifestPath, chunksDirectory);

    expect(report.chunks[0]).toMatchObject({
      expectedHash: sha256(original),
      actualHash: sha256(truncated),
      status: "HASH_MISMATCH",
    });
  });

  it("rejects malformed, empty, duplicate, and escaping manifest entries", () => {
    for (const contents of [
      "not a checksum entry\n",
      "",
      `${sha256("one")}  same.bin\n${sha256("two")}  same.bin\n`,
      `${sha256("outside")}  ../outside.bin\n`,
    ]) {
      writeManifest(contents);

      expect(verifySnapshotManifest(manifestPath, chunksDirectory).status).toBe(
        "INVALID_MANIFEST",
      );
    }
  });

  it("reports a non-file chunk path as a read error", () => {
    mkdirSync(path.join(chunksDirectory, "directory.bin"));
    writeManifest(`${sha256("contents")}  directory.bin\n`);

    const report = verifySnapshotManifest(manifestPath, chunksDirectory);

    expect(report.status).toBe("FAILED");
    expect(report.chunks[0]).toMatchObject({
      status: "READ_ERROR",
      errorMessage: "Chunk path is not a regular file",
    });
  });

  it("returns non-zero CLI codes for invalid manifests and file errors", () => {
    const log = jest.spyOn(console, "log").mockImplementation(() => {});
    jest.spyOn(console, "error").mockImplementation(() => {});

    writeManifest("not a checksum entry\n");
    expect(runCli([manifestPath, chunksDirectory])).toBe(2);

    expect(
      runCli([path.join(root, "missing-SHA256SUMS"), chunksDirectory]),
    ).toBe(2);

    writeManifest(`${sha256("expected")}  missing.bin\n`);
    expect(runCli([manifestPath, chunksDirectory])).toBe(1);

    mkdirSync(path.join(chunksDirectory, "directory.bin"));
    writeManifest(`${sha256("contents")}  directory.bin\n`);
    expect(runCli([manifestPath, chunksDirectory])).toBe(1);

    expect(runCli([])).toBe(2);
    expect(log).toHaveBeenCalledTimes(4);
  });
});
