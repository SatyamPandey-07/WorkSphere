/**
 * AssetGeofenceLedger.ts
 * RFID real-time physical asset tracking and geofence custody ledger.
 * Implements 2D ray-casting point-in-polygon zone localization, append-only SHA-256
 * hash-chained custody event transitions, perimeter egress breach alarms, and clearance tier governance.
 */

import { createHash } from 'crypto';

export interface Point2D {
  x: number;
  y: number;
}

export type SecurityClearanceTier = 'STANDARD' | 'RESTRICTED' | 'AIR_GAPPED';

export type AssetCategory =
  | 'COMPUTE_HARDWARE'
  | 'PERIPHERAL'
  | 'SPECIALIZED_TOOL'
  | 'FURNITURE';

export interface GeofenceZone {
  zoneId: string;
  name: string;
  polygonBoundary: Point2D[];
  floorNumber: number;
  authorizedTiers: SecurityClearanceTier[];
  isEgressPerimeter: boolean;
}

export interface AssetEntity {
  assetId: string;
  name: string;
  category: AssetCategory;
  rfidTagEpId: string;
  currentCustodianUserId: string | null;
  currentZoneId: string;
  securityClearanceTier: SecurityClearanceTier;
  isAuthorizedForEgress: boolean;
  lastSeenCoordinates: Point2D;
  lastSeenTimestamp: number;
}

export type CustodyEventType =
  | 'ZONE_TRANSITION'
  | 'CUSTODY_HANDOVER'
  | 'EGRESS_CHECKOUT'
  | 'RETURN';

export interface CustodyTransitionEvent {
  eventId: string;
  assetId: string;
  fromCustodian: string | null;
  toCustodian: string | null;
  fromZone: string;
  toZone: string;
  eventType: CustodyEventType;
  timestamp: number;
  prevHash: string;
  eventHash: string;
}

export type SecurityAlertType =
  | 'UNAUTHORIZED_EGRESS_BREACH'
  | 'CLEARANCE_VIOLATION'
  | 'LOST_BEACON_TIMEOUT';

export interface SecurityAlert {
  alertId: string;
  alertType: SecurityAlertType;
  assetId: string;
  zoneId: string;
  severity: 'CRITICAL' | 'WARNING';
  timestamp: number;
  message: string;
}

interface PendingZoneTransition {
  zoneId: string;
  confirmationCount: number;
  firstSeenAt: number;
}

const ZONE_TRANSITION_CONFIRMATION_SAMPLES = 3;
const ZONE_TRANSITION_COOLDOWN_MS = 1500;

export class AssetGeofenceLedger {
  private zones = new Map<string, GeofenceZone>();
  private assets = new Map<string, AssetEntity>(); // assetId -> AssetEntity
  private rfidToAssetId = new Map<string, string>(); // rfidTagEpId -> assetId

  private custodyLedger: CustodyTransitionEvent[] = [];
  private securityAlerts: SecurityAlert[] = [];
  private pendingZoneTransitions = new Map<string, PendingZoneTransition>();
  private lastZoneTransitionAt = new Map<string, number>();
  private latestLedgerHash = '0'.repeat(64); // Genesis hash

  public registerZone(zone: GeofenceZone): void {
    this.zones.set(zone.zoneId, { ...zone });
  }

  public registerAsset(asset: AssetEntity): void {
    this.assets.set(asset.assetId, { ...asset });
    this.rfidToAssetId.set(asset.rfidTagEpId, asset.assetId);
    this.pendingZoneTransitions.delete(asset.assetId);
    this.lastZoneTransitionAt.delete(asset.assetId);
  }

  public getAsset(assetId: string): AssetEntity | undefined {
    const a = this.assets.get(assetId);
    return a ? { ...a } : undefined;
  }

  public getZone(zoneId: string): GeofenceZone | undefined {
    const z = this.zones.get(zoneId);
    return z ? { ...z } : undefined;
  }

  public getSecurityAlerts(): SecurityAlert[] {
    return [...this.securityAlerts];
  }

  public getCustodyHistory(assetId?: string): CustodyTransitionEvent[] {
    if (!assetId) return [...this.custodyLedger];
    return this.custodyLedger.filter((e) => e.assetId === assetId);
  }

  public authorizeEgress(assetId: string, authorized: boolean): void {
    const asset = this.assets.get(assetId);
    if (asset) {
      asset.isAuthorizedForEgress = authorized;
    }
  }

  /**
   * Ray-casting algorithm to determine if a point resides inside a polygon
   */
  public isPointInPolygon(point: Point2D, polygon: Point2D[]): boolean {
    if (polygon.length < 3) return false;

    let inside = false;
    const n = polygon.length;

    for (let i = 0, j = n - 1; i < n; j = i++) {
      const xi = polygon[i].x;
      const yi = polygon[i].y;
      const xj = polygon[j].x;
      const yj = polygon[j].y;

      const intersect =
        yi > point.y !== yj > point.y &&
        point.x < ((xj - xi) * (point.y - yi)) / (yj - yi) + xi;

      if (intersect) inside = !inside;
    }

    return inside;
  }

  /**
   * Locates the zone enclosing coordinates on a given floor
   */
  public locateZone(point: Point2D, floorNumber: number): GeofenceZone | null {
    for (const zone of this.zones.values()) {
      if (zone.floorNumber === floorNumber && this.isPointInPolygon(point, zone.polygonBoundary)) {
        return zone;
      }
    }
    return null;
  }

  /**
   * Records real-time RFID/BLE beacon telemetry, executes geofence checks, and appends to ledger
   */
  public recordBeaconTelemetry(
    rfidTagEpId: string,
    coordinates: Point2D,
    floorNumber: number,
    currentTime: number = Date.now()
  ): {
    updated: boolean;
    currentZoneId?: string;
    alert?: SecurityAlert;
    event?: CustodyTransitionEvent;
  } {
    const assetId = this.rfidToAssetId.get(rfidTagEpId);
    if (!assetId) {
      return { updated: false };
    }

    const asset = this.assets.get(assetId)!;
    asset.lastSeenCoordinates = { ...coordinates };
    asset.lastSeenTimestamp = currentTime;

    const detectedZone = this.locateZone(coordinates, floorNumber);
    if (!detectedZone) {
      // An out-of-zone reading breaks the consecutive confirmation sequence.
      this.pendingZoneTransitions.delete(assetId);
      return { updated: true, currentZoneId: asset.currentZoneId };
    }

    const oldZoneId = asset.currentZoneId;
    const newZoneId = detectedZone.zoneId;

    let alert: SecurityAlert | undefined = undefined;
    let event: CustodyTransitionEvent | undefined = undefined;

    // Check for Perimeter Egress Breach
    if (detectedZone.isEgressPerimeter && !asset.isAuthorizedForEgress) {
      alert = {
        alertId: `alert_egress_${currentTime}_${Math.random().toString(36).substring(2, 7)}`,
        alertType: 'UNAUTHORIZED_EGRESS_BREACH',
        assetId: asset.assetId,
        zoneId: newZoneId,
        severity: 'CRITICAL',
        timestamp: currentTime,
        message: `Security Breach: Unauthorized removal of asset "${asset.name}" (${asset.assetId}) detected at perimeter zone ${detectedZone.name}.`,
      };
      this.securityAlerts.push(alert);
    }

    // Check for Security Clearance Violation
    if (!detectedZone.authorizedTiers.includes(asset.securityClearanceTier)) {
      alert = {
        alertId: `alert_clearance_${currentTime}_${Math.random().toString(36).substring(2, 7)}`,
        alertType: 'CLEARANCE_VIOLATION',
        assetId: asset.assetId,
        zoneId: newZoneId,
        severity: 'CRITICAL',
        timestamp: currentTime,
        message: `Clearance Violation: Asset "${asset.name}" (${asset.securityClearanceTier}) entered unauthorized zone ${detectedZone.name}.`,
      };
      this.securityAlerts.push(alert);
    }

    // A single boundary reading is not enough to move custody. Require three
    // consecutive readings for the same destination zone, spanning at least
    // 1500ms, and enforce a 1500ms cooldown between committed transitions.
    if (oldZoneId === newZoneId) {
      this.pendingZoneTransitions.delete(assetId);
    } else {
      const pending = this.pendingZoneTransitions.get(assetId);
      const nextPending: PendingZoneTransition =
        pending && pending.zoneId === newZoneId && currentTime >= pending.firstSeenAt
          ? {
              zoneId: newZoneId,
              confirmationCount: pending.confirmationCount + 1,
              firstSeenAt: pending.firstSeenAt,
            }
          : {
              zoneId: newZoneId,
              confirmationCount: 1,
              firstSeenAt: currentTime,
            };
      this.pendingZoneTransitions.set(assetId, nextPending);

      const lastTransitionAt = this.lastZoneTransitionAt.get(assetId);
      const cooldownElapsed =
        lastTransitionAt === undefined ||
        currentTime - lastTransitionAt >= ZONE_TRANSITION_COOLDOWN_MS;
      const confirmationElapsed =
        currentTime - nextPending.firstSeenAt >= ZONE_TRANSITION_COOLDOWN_MS;

      if (
        nextPending.confirmationCount >= ZONE_TRANSITION_CONFIRMATION_SAMPLES &&
        confirmationElapsed &&
        cooldownElapsed
      ) {
        asset.currentZoneId = newZoneId;
        event = this.appendEvent({
          assetId: asset.assetId,
          fromCustodian: asset.currentCustodianUserId,
          toCustodian: asset.currentCustodianUserId,
          fromZone: oldZoneId,
          toZone: newZoneId,
          eventType: detectedZone.isEgressPerimeter ? 'EGRESS_CHECKOUT' : 'ZONE_TRANSITION',
          timestamp: currentTime,
        });
        this.pendingZoneTransitions.delete(assetId);
        this.lastZoneTransitionAt.set(assetId, currentTime);
      }
    }

    return {
      updated: true,
      currentZoneId: asset.currentZoneId,
      alert,
      event,
    };
  }

  /**
   * Explicit custodian handover of an asset
   */
  public transferCustody(
    assetId: string,
    toCustodianUserId: string | null,
    currentTime: number = Date.now()
  ): CustodyTransitionEvent {
    const asset = this.assets.get(assetId);
    if (!asset) {
      throw new Error(`Asset ${assetId} not found`);
    }

    const fromCustodian = asset.currentCustodianUserId;
    asset.currentCustodianUserId = toCustodianUserId;

    return this.appendEvent({
      assetId,
      fromCustodian,
      toCustodian: toCustodianUserId,
      fromZone: asset.currentZoneId,
      toZone: asset.currentZoneId,
      eventType: toCustodianUserId === null ? 'RETURN' : 'CUSTODY_HANDOVER',
      timestamp: currentTime,
    });
  }

  /**
   * Cryptographic verification of the append-only ledger hash chain
   */
  public verifyLedgerIntegrity(): {
    isValid: boolean;
    eventCount: number;
    brokenEventId?: string;
  } {
    let expectedPrevHash = '0'.repeat(64);

    for (let i = 0; i < this.custodyLedger.length; i++) {
      const event = this.custodyLedger[i];

      if (event.prevHash !== expectedPrevHash) {
        return {
          isValid: false,
          eventCount: this.custodyLedger.length,
          brokenEventId: event.eventId,
        };
      }

      const computedHash = this.computeEventHash(event, event.prevHash);
      if (computedHash !== event.eventHash) {
        return {
          isValid: false,
          eventCount: this.custodyLedger.length,
          brokenEventId: event.eventId,
        };
      }

      expectedPrevHash = event.eventHash;
    }

    return {
      isValid: true,
      eventCount: this.custodyLedger.length,
    };
  }

  // --- Private Helpers ---

  private appendEvent(
    params: Omit<CustodyTransitionEvent, 'eventId' | 'prevHash' | 'eventHash'>
  ): CustodyTransitionEvent {
    const eventId = `custody_evt_${params.timestamp}_${this.custodyLedger.length + 1}`;
    const prevHash = this.latestLedgerHash;

    const eventWithoutHash = {
      ...params,
      eventId,
      prevHash,
    };

    const eventHash = this.computeEventHash(eventWithoutHash, prevHash);
    const fullEvent: CustodyTransitionEvent = {
      ...eventWithoutHash,
      eventHash,
    };

    this.custodyLedger.push(fullEvent);
    this.latestLedgerHash = eventHash;
    return fullEvent;
  }

  private computeEventHash(
    event: Omit<CustodyTransitionEvent, 'eventHash'>,
    prevHash: string
  ): string {
    const payload = `${event.eventId}:${event.assetId}:${event.fromCustodian}:${event.toCustodian}:${event.fromZone}:${event.toZone}:${event.eventType}:${event.timestamp}:${prevHash}`;
    return createHash('sha256').update(payload).digest('hex');
  }
}
