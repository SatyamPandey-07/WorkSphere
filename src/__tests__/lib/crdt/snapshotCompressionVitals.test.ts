import {
  buildSystemVitalsSnapshot,
  formatSystemVitalsPrometheus,
} from "@/lib/export/domain/systemVitalExporter";
import {
  recordCompression,
  recordDecompression,
  resetCompressionTelemetry,
} from "@/lib/crdt/compressionTelemetry";

describe("Snapshot compression metrics in admin vitals (#8015)", () => {
  beforeEach(() => resetCompressionTelemetry());

  it("includes size, duration and ratio in the vitals snapshot", () => {
    recordCompression(1000, 250, 3);
    recordDecompression(250, 1000, 1);

    const snapshot = buildSystemVitalsSnapshot();
    expect(snapshot.crdtSnapshotCompression).toMatchObject({
      compressionOps: 1,
      decompressionOps: 1,
      rawBytesCompressed: 1000,
      compressedBytes: 250,
      compressionMs: 3,
    });
    expect(snapshot.crdtSnapshotCompression?.compressionRatio).toBeCloseTo(
      0.75,
    );
  });

  it("exports the metrics in the Prometheus feed", () => {
    recordCompression(1000, 250, 3);
    recordCompression(3000, 750, 5);

    const body = formatSystemVitalsPrometheus(buildSystemVitalsSnapshot());
    expect(body).toContain("worksphere_crdt_snapshot_compressions_total 2");
    expect(body).toContain("worksphere_crdt_snapshot_raw_bytes_total 4000");
    expect(body).toContain(
      "worksphere_crdt_snapshot_compressed_bytes_total 1000",
    );
    expect(body).toContain(
      "worksphere_crdt_snapshot_compression_duration_ms_total 8",
    );
    expect(body).toContain("worksphere_crdt_snapshot_compression_ratio 0.75");
    expect(body).toContain(
      "# TYPE worksphere_crdt_snapshot_compression_ratio gauge",
    );
  });

  it("emits zeroed metrics when nothing has been compressed", () => {
    const body = formatSystemVitalsPrometheus(buildSystemVitalsSnapshot());
    expect(body).toContain("worksphere_crdt_snapshot_compressions_total 0");
    expect(body).toContain("worksphere_crdt_snapshot_compression_ratio 0");
  });
});
