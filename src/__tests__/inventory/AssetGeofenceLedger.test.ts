import {
  AssetGeofenceLedger,
  GeofenceZone,
  AssetEntity,
  Point2D,
} from '../../core/inventory/AssetGeofenceLedger';

describe('AssetGeofenceLedger', () => {
  let ledger: AssetGeofenceLedger;

  const fabLabZone: GeofenceZone = {
    zoneId: 'zone-fablab-1',
    name: 'Hardware Fabrication Lab',
    floorNumber: 2,
    isEgressPerimeter: false,
    authorizedTiers: ['STANDARD', 'RESTRICTED', 'AIR_GAPPED'],
    polygonBoundary: [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ],
  };

  const publicLobbyZone: GeofenceZone = {
    zoneId: 'zone-lobby-1',
    name: 'Ground Floor Public Cafe',
    floorNumber: 1,
    isEgressPerimeter: false,
    authorizedTiers: ['STANDARD'], // RESTRICTED & AIR_GAPPED not allowed!
    polygonBoundary: [
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      { x: 200, y: 150 },
      { x: 0, y: 150 },
    ],
  };

  const exitGateZone: GeofenceZone = {
    zoneId: 'zone-exit-gate',
    name: 'Building Main Turnstiles',
    floorNumber: 1,
    isEgressPerimeter: true, // Exit boundary!
    authorizedTiers: ['STANDARD', 'RESTRICTED'],
    polygonBoundary: [
      { x: 200, y: 0 },
      { x: 250, y: 0 },
      { x: 250, y: 50 },
      { x: 200, y: 50 },
    ],
  };

  const vrHeadset: AssetEntity = {
    assetId: 'asset-vr-001',
    name: 'Apple Vision Pro Dev Kit',
    category: 'COMPUTE_HARDWARE',
    rfidTagEpId: 'rfid_tag_998877',
    currentCustodianUserId: 'user-engineer-1',
    currentZoneId: 'zone-fablab-1',
    securityClearanceTier: 'RESTRICTED',
    isAuthorizedForEgress: false,
    lastSeenCoordinates: { x: 50, y: 50 },
    lastSeenTimestamp: 1000,
  };

  beforeEach(() => {
    ledger = new AssetGeofenceLedger();
    ledger.registerZone(fabLabZone);
    ledger.registerZone(publicLobbyZone);
    ledger.registerZone(exitGateZone);
    ledger.registerAsset(vrHeadset);
  });

  describe('Point-in-Polygon & Zone Localization', () => {
    it('correctly determines whether point resides inside or outside polygon', () => {
      const square = [
        { x: 10, y: 10 },
        { x: 50, y: 10 },
        { x: 50, y: 50 },
        { x: 10, y: 50 },
      ];

      expect(ledger.isPointInPolygon({ x: 30, y: 30 }, square)).toBe(true);
      expect(ledger.isPointInPolygon({ x: 5, y: 5 }, square)).toBe(false);
      expect(ledger.isPointInPolygon({ x: 60, y: 30 }, square)).toBe(false);
    });

    it('locates enclosing zone by floor number and coordinates', () => {
      const zone = ledger.locateZone({ x: 50, y: 50 }, 2);
      expect(zone).not.toBeNull();
      expect(zone?.zoneId).toBe('zone-fablab-1');

      const lobby = ledger.locateZone({ x: 150, y: 80 }, 1);
      expect(lobby?.zoneId).toBe('zone-lobby-1');
    });
  });

  describe('Telemetry & Security Violation Detection', () => {
    it('requires three consecutive readings spanning 1500ms before recording a zone transition', () => {
      const first = ledger.recordBeaconTelemetry(
        'rfid_tag_998877',
        { x: 50, y: 50 },
        1,
        10000
      );
      const second = ledger.recordBeaconTelemetry(
        'rfid_tag_998877',
        { x: 55, y: 55 },
        1,
        10750
      );
      const third = ledger.recordBeaconTelemetry(
        'rfid_tag_998877',
        { x: 60, y: 60 },
        1,
        11500
      );

      expect(first.event).toBeUndefined();
      expect(second.event).toBeUndefined();
      expect(first.currentZoneId).toBe('zone-fablab-1');
      expect(second.currentZoneId).toBe('zone-fablab-1');
      expect(third.event).toBeDefined();
      expect(third.event?.fromZone).toBe('zone-fablab-1');
      expect(third.event?.toZone).toBe('zone-lobby-1');
      expect(third.currentZoneId).toBe('zone-lobby-1');
      expect(ledger.getCustodyHistory('asset-vr-001')).toHaveLength(1);
    });

    it('resets confirmation when readings bounce back across the geofence boundary', () => {
      ledger.recordBeaconTelemetry(
        'rfid_tag_998877',
        { x: 50, y: 50 },
        1,
        10000
      );
      ledger.recordBeaconTelemetry(
        'rfid_tag_998877',
        { x: 50, y: 50 },
        2,
        10500
      );
      ledger.recordBeaconTelemetry(
        'rfid_tag_998877',
        { x: 50, y: 50 },
        1,
        11000
      );
      const stillPending = ledger.recordBeaconTelemetry(
        'rfid_tag_998877',
        { x: 50, y: 50 },
        1,
        12500
      );

      expect(stillPending.event).toBeUndefined();
      expect(stillPending.currentZoneId).toBe('zone-fablab-1');
      expect(ledger.getCustodyHistory('asset-vr-001')).toHaveLength(0);
    });

    it('triggers CRITICAL alert when restricted asset crosses egress perimeter without authorization', () => {
      const result = ledger.recordBeaconTelemetry(
        'rfid_tag_998877',
        { x: 220, y: 25 }, // Inside exitGateZone
        1,
        2000
      );

      expect(result.updated).toBe(true);
      expect(result.alert).toBeDefined();
      expect(result.alert?.alertType).toBe('UNAUTHORIZED_EGRESS_BREACH');
      expect(result.alert?.severity).toBe('CRITICAL');

      const alerts = ledger.getSecurityAlerts();
      expect(alerts.length).toBe(1);
    });

    it('permits authorized egress without security breach alert', () => {
      ledger.authorizeEgress('asset-vr-001', true);

      const result = ledger.recordBeaconTelemetry(
        'rfid_tag_998877',
        { x: 220, y: 25 },
        1,
        3000
      );

      expect(result.updated).toBe(true);
      expect(result.alert).toBeUndefined(); // No breach!
    });

    it('triggers CLEARANCE_VIOLATION when restricted asset enters unauthorized zone', () => {
      // Move into public lobby (only allows STANDARD)
      const result = ledger.recordBeaconTelemetry(
        'rfid_tag_998877',
        { x: 50, y: 50 },
        1,
        4000
      );

      expect(result.updated).toBe(true);
      expect(result.alert?.alertType).toBe('CLEARANCE_VIOLATION');
      expect(result.alert?.message).toContain('Clearance Violation');
    });
  });

  describe('Custody Handover & Ledger Hash-Chain Integrity', () => {
    it('records custody handover and verifies append-only hash chain', () => {
      ledger.transferCustody('asset-vr-001', 'user-researcher-2', 5000);
      ledger.transferCustody('asset-vr-001', null, 6000); // Returned to inventory

      const history = ledger.getCustodyHistory('asset-vr-001');
      expect(history.length).toBe(2);
      expect(history[0].eventType).toBe('CUSTODY_HANDOVER');
      expect(history[0].toCustodian).toBe('user-researcher-2');
      expect(history[1].eventType).toBe('RETURN');
      expect(history[1].toCustodian).toBeNull();

      // Verify cryptographic chain
      const integrity = ledger.verifyLedgerIntegrity();
      expect(integrity.isValid).toBe(true);
      expect(integrity.eventCount).toBe(2);
    });

    it('detects tampering in ledger hash chain', () => {
      ledger.transferCustody('asset-vr-001', 'user-researcher-2', 5000);
      ledger.transferCustody('asset-vr-001', null, 6000);

      // Access internal events and tamper with previous hash
      const rawLedger = (ledger as any).custodyLedger;
      rawLedger[1].prevHash = 'tampered_hash_value';

      const integrity = ledger.verifyLedgerIntegrity();
      expect(integrity.isValid).toBe(false);
      expect(integrity.brokenEventId).toBe(rawLedger[1].eventId);
    });
  });
});
