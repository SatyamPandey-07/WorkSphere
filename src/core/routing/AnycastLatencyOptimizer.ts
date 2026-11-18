/**
 * AnycastLatencyOptimizer.ts
 * Geo-distributed Anycast BGP latency optimizer and catchment steering coordinator.
 * Detects BGP routing path inflation, calculates speed-of-light in silica fiber RTT baselines,
 * evaluates catchment efficiency, and synthesizes AS-Path prepending / BGP community steering rules.
 */

export interface GeoCoordinates {
  latitude: number;
  longitude: number;
}

export type PoPHealthStatus = 'HEALTHY' | 'DEGRADED' | 'DRAINING' | 'OFFLINE';

export interface EdgePoP {
  popCode: string;
  regionName: string;
  coordinates: GeoCoordinates;
  capacityLimitRps: number;
  currentLoadRps: number;
  healthStatus: PoPHealthStatus;
  upstreamAsns: number[];
}

export interface ClientTelemetry {
  clientId: string;
  coordinates: GeoCoordinates;
  ingressPopCode: string;
  measuredRttMs: number;
  jitterMs?: number;
  packetLossPercent?: number;
}

export type RoutingEfficiencyClass = 'OPTIMAL' | 'SUBOPTIMAL' | 'SEVERE_INFLATION';

export type BgpSteeringAction =
  | 'NO_ACTION'
  | 'AS_PATH_PREPEND_1X'
  | 'AS_PATH_PREPEND_2X'
  | 'AS_PATH_PREPEND_3X'
  | 'COMMUNITY_STEER_FAILOVER';

export interface CatchmentEvaluation {
  clientId: string;
  ingressPopCode: string;
  closestGeographicPopCode: string;
  distanceToIngressKm: number;
  distanceToClosestKm: number;
  measuredRttMs: number;
  theoreticalMinRttMs: number;
  inflationRatio: number;
  efficiencyClass: RoutingEfficiencyClass;
  recommendedAction: BgpSteeringAction;
  targetPopCode?: string;
  reason: string;
}

export interface BgpSteeringRule {
  affectedPopCode: string;
  action: BgpSteeringAction;
  prependMultiplier: number;
  targetCommunityTag?: string;
  rationale: string;
}

export interface DrainSimulationResult {
  drainedPopCode: string;
  reallocatedRps: number;
  fallbackAllocations: {
    popCode: string;
    allocatedRps: number;
    newLoadRps: number;
  }[];
}

export class AnycastLatencyOptimizer {
  private pops = new Map<string, EdgePoP>();
  private speedOfLightFiberKmPerSec = 200000; // ~2/3 of vacuum c in standard single-mode silica core
  private fixedSwitchingOverheadMs = 4.0; // Typical packet queuing, serialization, and edge switch processing

  constructor(initialPops?: EdgePoP[]) {
    if (initialPops) {
      for (const p of initialPops) {
        this.registerPoP(p);
      }
    }
  }

  public registerPoP(pop: EdgePoP): void {
    this.pops.set(pop.popCode, { ...pop });
  }

  public removePoP(popCode: string): void {
    this.pops.delete(popCode);
  }

  public getPoP(popCode: string): EdgePoP | undefined {
    const pop = this.pops.get(popCode);
    return pop ? { ...pop } : undefined;
  }

  public getAllPoPs(): EdgePoP[] {
    return Array.from(this.pops.values()).map((p) => ({ ...p }));
  }

  public updatePoPHealth(popCode: string, status: PoPHealthStatus): void {
    const pop = this.pops.get(popCode);
    if (pop) {
      pop.healthStatus = status;
    }
  }

  public updatePoPLoad(popCode: string, currentLoadRps: number): void {
    const pop = this.pops.get(popCode);
    if (pop) {
      pop.currentLoadRps = currentLoadRps;
    }
  }

  /**
   * Calculates geodesic great-circle distance between two coordinates using the Haversine formula
   */
  public computeHaversineDistanceKm(coord1: GeoCoordinates, coord2: GeoCoordinates): number {
    const earthRadiusKm = 6371.0;
    const lat1Rad = (coord1.latitude * Math.PI) / 180.0;
    const lat2Rad = (coord2.latitude * Math.PI) / 180.0;
    const dLat = ((coord2.latitude - coord1.latitude) * Math.PI) / 180.0;
    const dLon = ((coord2.longitude - coord1.longitude) * Math.PI) / 180.0;

    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1Rad) * Math.cos(lat2Rad) * Math.sin(dLon / 2) * Math.sin(dLon / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return parseFloat((earthRadiusKm * c).toFixed(2));
  }

  /**
   * Calculates theoretical minimum round-trip time in silica fiber
   */
  public computeTheoreticalMinRttMs(distanceKm: number): number {
    if (distanceKm <= 0) return this.fixedSwitchingOverheadMs;
    // Round trip distance = 2 * distanceKm
    const travelTimeSec = (2 * distanceKm) / this.speedOfLightFiberKmPerSec;
    const travelTimeMs = travelTimeSec * 1000;
    return parseFloat((travelTimeMs + this.fixedSwitchingOverheadMs).toFixed(2));
  }

  /**
   * Finds the closest operational Edge PoP geographically
   */
  public findClosestOperationalPoP(
    coords: GeoCoordinates
  ): { pop: EdgePoP; distanceKm: number } | null {
    let closestPop: EdgePoP | null = null;
    let minDistance = Infinity;

    for (const pop of this.pops.values()) {
      if (pop.healthStatus === 'OFFLINE') continue;
      const dist = this.computeHaversineDistanceKm(coords, pop.coordinates);
      if (dist < minDistance) {
        minDistance = dist;
        closestPop = pop;
      }
    }

    if (!closestPop) return null;
    return { pop: closestPop, distanceKm: minDistance };
  }

  /**
   * Evaluates telemetry from client to identify BGP catchment inflation
   */
  public evaluateTelemetry(telemetry: ClientTelemetry): CatchmentEvaluation {
    const ingressPop = this.pops.get(telemetry.ingressPopCode);
    const closestMatch = this.findClosestOperationalPoP(telemetry.coordinates);

    const distanceToClosestKm = closestMatch ? closestMatch.distanceKm : 0;
    const closestPopCode = closestMatch ? closestMatch.pop.popCode : telemetry.ingressPopCode;

    const distanceToIngressKm = ingressPop
      ? this.computeHaversineDistanceKm(telemetry.coordinates, ingressPop.coordinates)
      : distanceToClosestKm;

    const theoreticalMinRttMs = this.computeTheoreticalMinRttMs(distanceToIngressKm);
    const measuredRtt = Math.max(1.0, telemetry.measuredRttMs);
    const inflationRatio = parseFloat((measuredRtt / Math.max(1.0, theoreticalMinRttMs)).toFixed(2));

    let efficiencyClass: RoutingEfficiencyClass = 'OPTIMAL';
    let recommendedAction: BgpSteeringAction = 'NO_ACTION';
    let targetPopCode: string | undefined = undefined;
    let reason = 'Routing latency adheres to optimal geodesic bounds.';

    // Check if ingress PoP is degraded or offline
    if (ingressPop && (ingressPop.healthStatus === 'DEGRADED' || ingressPop.healthStatus === 'DRAINING')) {
      efficiencyClass = 'SEVERE_INFLATION';
      recommendedAction = 'COMMUNITY_STEER_FAILOVER';
      targetPopCode = closestPopCode !== telemetry.ingressPopCode ? closestPopCode : undefined;
      reason = `Ingress PoP ${telemetry.ingressPopCode} is in ${ingressPop.healthStatus} state. Traffic failover required.`;
    } else if (ingressPop && ingressPop.currentLoadRps >= ingressPop.capacityLimitRps * 0.95) {
      efficiencyClass = 'SUBOPTIMAL';
      recommendedAction = 'AS_PATH_PREPEND_2X';
      targetPopCode = closestPopCode;
      reason = `Ingress PoP ${telemetry.ingressPopCode} is operating at ${((ingressPop.currentLoadRps / ingressPop.capacityLimitRps) * 100).toFixed(0)}% capacity. Prepending required to shed load.`;
    } else if (inflationRatio > 2.8 || (closestPopCode !== telemetry.ingressPopCode && distanceToIngressKm > distanceToClosestKm * 2.5)) {
      efficiencyClass = 'SEVERE_INFLATION';
      recommendedAction = 'AS_PATH_PREPEND_3X';
      targetPopCode = closestPopCode;
      reason = `Severe BGP anycast catchment inflation detected (ratio ${inflationRatio}). Client routed to ${telemetry.ingressPopCode} (${distanceToIngressKm}km) instead of nearest ${closestPopCode} (${distanceToClosestKm}km).`;
    } else if (inflationRatio > 1.8) {
      efficiencyClass = 'SUBOPTIMAL';
      recommendedAction = 'AS_PATH_PREPEND_1X';
      targetPopCode = closestPopCode;
      reason = `Moderate BGP path inflation (ratio ${inflationRatio}). Light AS-path prepending recommended.`;
    }

    return {
      clientId: telemetry.clientId,
      ingressPopCode: telemetry.ingressPopCode,
      closestGeographicPopCode: closestPopCode,
      distanceToIngressKm,
      distanceToClosestKm,
      measuredRttMs: measuredRtt,
      theoreticalMinRttMs,
      inflationRatio,
      efficiencyClass,
      recommendedAction,
      targetPopCode,
      reason,
    };
  }

  /**
   * Synthesizes global BGP steering rules across all registered PoPs
   */
  public generateBgpSteeringRules(): BgpSteeringRule[] {
    const rules: BgpSteeringRule[] = [];

    for (const pop of this.pops.values()) {
      if (pop.healthStatus === 'DEGRADED' || pop.healthStatus === 'DRAINING') {
        rules.push({
          affectedPopCode: pop.popCode,
          action: 'COMMUNITY_STEER_FAILOVER',
          prependMultiplier: 0,
          targetCommunityTag: `65000:${pop.popCode}:NO_EXPORT`,
          rationale: `Withdraw or no-export route advertisement for ${pop.healthStatus} PoP ${pop.popCode}.`,
        });
      } else if (pop.currentLoadRps >= pop.capacityLimitRps * 0.95) {
        rules.push({
          affectedPopCode: pop.popCode,
          action: 'AS_PATH_PREPEND_2X',
          prependMultiplier: 2,
          targetCommunityTag: `65000:${pop.popCode}:SHED_TRANSIT`,
          rationale: `PoP ${pop.popCode} is near saturation. 2x AS-Path prepending applied to shed border transit.`,
        });
      } else if (pop.currentLoadRps >= pop.capacityLimitRps * 0.85) {
        rules.push({
          affectedPopCode: pop.popCode,
          action: 'AS_PATH_PREPEND_1X',
          prependMultiplier: 1,
          targetCommunityTag: `65000:${pop.popCode}:SOFT_SHED`,
          rationale: `PoP ${pop.popCode} load is high (>85%). 1x AS-Path prepending applied.`,
        });
      }
    }

    return rules;
  }

  /**
   * Simulates graceful connection drain for maintenance
   */
  public simulateGracefulDrain(popCode: string): DrainSimulationResult {
    const targetPop = this.pops.get(popCode);
    if (!targetPop) {
      throw new Error(`PoP ${popCode} not found`);
    }

    const reallocatedRps = targetPop.currentLoadRps;
    targetPop.healthStatus = 'DRAINING';
    targetPop.currentLoadRps = 0;

    // Distribute load among remaining HEALTHY PoPs inversely proportional to distance
    const candidatePops = Array.from(this.pops.values()).filter(
      (p) => p.popCode !== popCode && p.healthStatus === 'HEALTHY'
    );

    if (candidatePops.length === 0) {
      return {
        drainedPopCode: popCode,
        reallocatedRps,
        fallbackAllocations: [],
      };
    }

    // Weight candidate PoPs by remaining headroom capacity
    let totalHeadroom = 0;
    for (const c of candidatePops) {
      const headroom = Math.max(0, c.capacityLimitRps - c.currentLoadRps);
      totalHeadroom += headroom;
    }

    const fallbackAllocations = candidatePops.map((c) => {
      const headroom = Math.max(0, c.capacityLimitRps - c.currentLoadRps);
      const ratio = totalHeadroom > 0 ? headroom / totalHeadroom : 1.0 / candidatePops.length;
      const allocated = Math.round(reallocatedRps * ratio);
      c.currentLoadRps += allocated;
      return {
        popCode: c.popCode,
        allocatedRps: allocated,
        newLoadRps: c.currentLoadRps,
      };
    });

    return {
      drainedPopCode: popCode,
      reallocatedRps,
      fallbackAllocations,
    };
  }
}
