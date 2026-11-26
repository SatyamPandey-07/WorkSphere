import {
  generateBatchCheckInAttestationCSV,
  exportBatchCheckInAttestationToCSV,
  BatchCheckInAttestationRecord,
  ATTESTATION_CSV_HEADERS,
} from "@/lib/batchCheckInAttestationCsvExport";

describe("Batch Check-In Attestation CSV Export (Issue #10604)", () => {
  it("exports both verified and rejected rows with formula-injection characters escaped", () => {
    const records: BatchCheckInAttestationRecord[] = [
      // 1. Valid / Verified row with normal values
      {
        bookingId: "bk_valid_001",
        userId: "usr_alice",
        userName: "Alice Smith",
        venueId: "ven_central_hub",
        venueName: "Central Hub Coworking",
        status: "verified",
        confidence: 0.98,
        reason: "Geofence GPS and WiFi SSID matched",
        sensorDetails: "GPS: <5m accuracy, WiFi: Office_Mesh_5G",
        timestamp: "2026-11-26T12:00:00.000Z",
      },
      // 2. Rejected row with malicious formula injection beginning with '='
      {
        bookingId: "=cmd|' /C calc'!A0",
        userId: "usr_attacker_1",
        userName: "=1+1",
        venueId: "ven_central_hub",
        venueName: "Central Hub Coworking",
        status: "rejected",
        confidence: 0.12,
        reason: "=SUM(1,2)",
        sensorDetails: "Spoofed GPS coordinates",
        timestamp: "2026-11-26T12:05:00.000Z",
      },
      // 3. Rejected row with formula injection beginning with '+', '-', and '@'
      {
        bookingId: "+447700900077",
        userId: "-99999",
        userName: "@AdminAccount",
        venueId: "ven_central_hub",
        venueName: "Central Hub Coworking",
        status: "rejected",
        confidence: 0.0,
        reason: "-DANGEROUS_PARAM",
        sensorDetails: "@internal-sensor-endpoint",
        timestamp: "2026-11-26T12:10:00.000Z",
      },
      // 4. Verified row with leading whitespace before formula trigger
      {
        bookingId: "bk_valid_002",
        userId: "usr_bob",
        userName: "   =cmd|' /C calc'!A0",
        venueId: "ven_central_hub",
        venueName: "Central Hub Coworking",
        status: "verified",
        confidence: 0.95,
        reason: "   @trusted_source",
        sensorDetails: "GPS: <8m accuracy",
        timestamp: "2026-11-26T12:15:00.000Z",
      },
    ];

    const csv = generateBatchCheckInAttestationCSV(records);
    const lines = csv.split("\r\n");

    // Header check
    expect(lines[0]).toBe(
      "Booking ID,User ID,User Name,Venue ID,Venue Name,Status,Confidence,Reason / Details,Sensor Details,Timestamp"
    );

    // Row 1: Normal verified row
    expect(lines[1]).toContain("bk_valid_001,usr_alice,Alice Smith,ven_central_hub");
    expect(lines[1]).toContain("VERIFIED");
    expect(lines[1]).toContain("0.98");

    // Row 2: Rejected row with '=' formula triggers escaped with single quote (')
    expect(lines[2]).toContain("''=cmd|' /C calc'!A0");
    expect(lines[2]).toContain("''=1+1");
    expect(lines[2]).toContain("REJECTED");
    expect(lines[2]).toContain("''=SUM(1,2)");

    // Row 3: Rejected row with '+', '-', '@' formula triggers escaped
    expect(lines[3]).toContain("'+447700900077");
    expect(lines[3]).toContain("'-99999");
    expect(lines[3]).toContain("'@AdminAccount");
    expect(lines[3]).toContain("REJECTED");
    expect(lines[3]).toContain("'-DANGEROUS_PARAM");
    expect(lines[3]).toContain("'@internal-sensor-endpoint");

    // Row 4: Verified row with leading whitespace formula triggers escaped
    expect(lines[4]).toContain("VERIFIED");
    expect(lines[4]).toContain("'   =cmd|' /C calc'!A0");
    expect(lines[4]).toContain("'   @trusted_source");

    // Ensure CSV Blob generation works
    const blob = exportBatchCheckInAttestationToCSV(records);
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toContain("text/csv");
  });
});
