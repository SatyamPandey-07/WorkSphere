/**
 * TransitSolver.ts
 * Solves the Time-Window Constrained Traveling Salesperson Problem (TSPTW)
 * for multi-venue itinerary optimization using Branch-and-Bound traversal.
 */

import { ItineraryGraph } from "./ItineraryGraph";
import { TimeWindowConstraint } from "./TimeWindowConstraint";
import type { TransitEdge } from "./ItineraryGraph";

export interface ItinerarySolution {
  sequence: string[]; // Ordered list of venue IDs
  totalDurationMinutes: number; // Transit + Dwell + Wait times
  totalTransitTimeMinutes: number;
  totalDwellTimeMinutes: number;
  totalWaitTimeMinutes: number;
  totalCarbonGrams: number;
  totalCost: number;
  startTime: Date;
  endTime: Date;
  schedule: Array<{
    venueId: string;
    venueName: string;
    arrivalTime: Date;
    departureTime: Date;
    waitTimeMinutes: number;
    carbonGrams: number;
    mode?: TransitEdge["mode"];
  }>;
}

export type TransitOptimizationObjective = "time" | "cost" | "carbon";

export const TRANSIT_EMISSION_COEFFICIENTS: Record<TransitEdge["mode"], number> = {
  walking: 0,
  cycling: 4,
  train: 41,
  rideshare: 120,
  driving: 171,
};

export interface TransitSolverOptions {
  maxDepth?: number;
  maxExecutionTimeMs?: number;
  pruneTimeWindowViolations?: boolean;
  objective?: TransitOptimizationObjective;
}

export class TransitSolver {
  private graph: ItineraryGraph;
  private timeConstraint: TimeWindowConstraint;

  constructor(graph: ItineraryGraph, timeConstraint: TimeWindowConstraint) {
    this.graph = graph;
    this.timeConstraint = timeConstraint;
  }

  /**
   * Solves the TSPTW to find the optimal visitation order minimizing total trip duration.
   */
  public solve(
    startVenueId: string,
    targetVenueIds: string[],
    startTime: Date,
    options: TransitSolverOptions = {},
  ): ItinerarySolution | null {
    const maxExecutionTimeMs = options.maxExecutionTimeMs ?? 5000;
    const startTimestamp = Date.now();

    const startNode = this.graph.getNode(startVenueId);
    if (!startNode) {
      throw new Error(`Start venue node '${startVenueId}' not found in graph.`);
    }

    const unvisited = new Set(
      targetVenueIds.filter((id) => id !== startVenueId),
    );
    let bestSolution: ItinerarySolution | null = null;
    let bestCost = Infinity;
    const objective = options.objective ?? "time";

    // Search state for Branch-and-Bound recursion
    const initialScheduleItem = {
      venueId: startVenueId,
      venueName: startNode.name,
      arrivalTime: startTime,
      departureTime: new Date(
        startTime.getTime() + startNode.averageDwellTimeMinutes * 60000,
      ),
      waitTimeMinutes: 0,
      carbonGrams: 0,
    };

    const search = (
      currentVenueId: string,
      currentTime: Date,
      visited: string[],
      currentSchedule: (typeof initialScheduleItem)[],
      accumulatedTransitTime: number,
      accumulatedDwellTime: number,
      accumulatedWaitTime: number,
      accumulatedCarbonGrams: number,
      accumulatedCost: number,
      remainingTargets: Set<string>,
    ) => {
      // Check execution time safety limit
      if (Date.now() - startTimestamp > maxExecutionTimeMs) {
        return;
      }

      // Base case: All target venues visited
      if (remainingTargets.size === 0) {
        const totalDuration =
          accumulatedTransitTime + accumulatedDwellTime + accumulatedWaitTime;

        const objectiveValue =
          objective === "carbon"
            ? accumulatedCarbonGrams
            : objective === "cost"
              ? accumulatedCost
              : totalDuration;
        if (objectiveValue < bestCost) {
          bestCost = objectiveValue;
          bestSolution = {
            sequence: [...visited],
            totalDurationMinutes: totalDuration,
            totalTransitTimeMinutes: accumulatedTransitTime,
            totalDwellTimeMinutes: accumulatedDwellTime,
            totalWaitTimeMinutes: accumulatedWaitTime,
            totalCarbonGrams: accumulatedCarbonGrams,
            totalCost: accumulatedCost,
            startTime,
            endTime: currentTime,
            schedule: [...currentSchedule],
          };
        }
        return;
      }

      // Bounding & Pruning: Compute lower bound for remaining unvisited nodes
      const lowerBound =
        accumulatedTransitTime +
        accumulatedDwellTime +
        accumulatedWaitTime +
        this.computeLowerBound(currentVenueId, remainingTargets);

      if (objective === "time" && lowerBound >= bestCost) {
        return; // PRUNE: Lower bound exceeds best solution cost found so far
      }

      // Branching: Sort unvisited candidates by heuristic (shortest transit time / time window urgency)
      const candidates = Array.from(remainingTargets).sort((a, b) => {
        const edgeA = this.graph.getEdge(currentVenueId, a);
        const edgeB = this.graph.getEdge(currentVenueId, b);
        const tA = edgeA ? edgeA.transitTimeMinutes : Infinity;
        const tB = edgeB ? edgeB.transitTimeMinutes : Infinity;
        return tA - tB;
      });

      for (const nextVenueId of candidates) {
        const edge = this.graph.getEdge(currentVenueId, nextVenueId);
        if (!edge) continue; // No direct edge exists

        const nextNode = this.graph.getNode(nextVenueId);
        if (!nextNode) continue;

        const transitTime = edge.transitTimeMinutes;
        const carbonGrams = this.calculateEdgeCarbonGrams(edge);
        const arrivalTimestamp = new Date(
          currentTime.getTime() + transitTime * 60000,
        );

        // Time Window Validation & Wait Time Computation
        let effectiveArrival = arrivalTimestamp;
        let waitTime = 0;

        if (!this.timeConstraint.isVenueOpenAt(nextVenueId, arrivalTimestamp)) {
          // Attempt to find next opening window
          const nextOpen = this.timeConstraint.getNextOpeningTime(
            nextVenueId,
            arrivalTimestamp,
          );

          if (!nextOpen) {
            continue; // PRUNE: Venue is closed and no future open window exists in horizon
          }

          waitTime = Math.round(
            (nextOpen.getTime() - arrivalTimestamp.getTime()) / 60000,
          );
          effectiveArrival = nextOpen;
        }

        const departureTime = new Date(
          effectiveArrival.getTime() + nextNode.averageDwellTimeMinutes * 60000,
        );

        const newRemaining = new Set(remainingTargets);
        newRemaining.delete(nextVenueId);

        search(
          nextVenueId,
          departureTime,
          [...visited, nextVenueId],
          [
            ...currentSchedule,
            {
              venueId: nextVenueId,
              venueName: nextNode.name,
              arrivalTime: effectiveArrival,
              departureTime,
              waitTimeMinutes: waitTime,
              carbonGrams,
              mode: edge.mode,
            },
          ],
          accumulatedTransitTime + transitTime,
          accumulatedDwellTime + nextNode.averageDwellTimeMinutes,
          accumulatedWaitTime + waitTime,
          accumulatedCarbonGrams + carbonGrams,
          accumulatedCost + (edge.cost ?? 0),
          newRemaining,
        );
      }
    };

    search(
      startVenueId,
      initialScheduleItem.departureTime,
      [startVenueId],
      [initialScheduleItem],
      0,
      startNode.averageDwellTimeMinutes,
      0,
      0,
      0,
      unvisited,
    );

    return bestSolution;
  }

  /**
   * Adapter for endpoint route optimization requests.
   */
  public optimize(
    startVenueId: string,
    targetVenueIds: string[],
    startTime: Date,
    objective: TransitOptimizationObjective = "time",
  ) {
    const res = this.solve(startVenueId, targetVenueIds, startTime, {
      objective,
    });
    if (!res) {
      return {
        startVenueId,
        stops: [],
        totalTravelMinutes: 0,
        totalDurationMinutes: 0,
        isFeasible: false,
      };
    }
    return {
      startVenueId,
      stops: res.schedule.map((s) => ({
        venueId: s.venueId,
        venueName: s.venueName,
        arrivalTime: s.arrivalTime.toISOString(),
        departureTime: s.departureTime.toISOString(),
        transitMinutesFromPrev: 0,
        dwellMinutes: Math.round(
          (s.departureTime.getTime() - s.arrivalTime.getTime()) / 60000,
        ),
        mode: s.mode,
        carbonGrams: s.carbonGrams,
      })),
      totalTravelMinutes: res.totalTransitTimeMinutes,
      totalDurationMinutes: res.totalDurationMinutes,
      totalCarbonGrams: res.totalCarbonGrams,
      totalCost: res.totalCost,
      objective,
      isFeasible: true,
    };
  }

  public optimizePareto(
    startVenueId: string,
    targetVenueIds: string[],
    startTime: Date,
  ) {
    return (["time", "carbon"] as const)
      .map((objective) =>
        this.solve(startVenueId, targetVenueIds, startTime, { objective }),
      )
      .filter((solution): solution is ItinerarySolution => solution !== null)
      .filter(
        (solution, index, solutions) =>
          solutions.findIndex(
            (candidate) =>
              candidate.sequence.join("|") === solution.sequence.join("|"),
          ) === index,
      )
      .map((solution) => ({
        sequence: solution.sequence,
        totalDurationMinutes: solution.totalDurationMinutes,
        totalCarbonGrams: solution.totalCarbonGrams,
        totalCost: solution.totalCost,
      }));
  }

  private calculateEdgeCarbonGrams(edge: TransitEdge): number {
    const coefficient =
      edge.co2GramsPerKm ?? TRANSIT_EMISSION_COEFFICIENTS[edge.mode];
    if (!Number.isFinite(coefficient) || coefficient < 0) {
      throw new Error(`Invalid carbon coefficient for ${edge.mode} edge`);
    }
    return Math.round((edge.distanceMeters / 1000) * coefficient * 100) / 100;
  }

  /**
   * Computes lower bound for remaining unvisited nodes using minimum outgoing edge weights.
   */
  private computeLowerBound(
    currentVenueId: string,
    unvisitedNodes: Set<string>,
  ): number {
    let bound = 0;
    const nodes = [currentVenueId, ...Array.from(unvisitedNodes)];

    for (const fromId of nodes) {
      const fromNode = this.graph.getNode(fromId);
      if (fromNode) {
        bound += fromNode.averageDwellTimeMinutes;
      }

      let minTransit = Infinity;
      for (const toId of unvisitedNodes) {
        if (fromId === toId) continue;
        const edge = this.graph.getEdge(fromId, toId);
        if (edge && edge.transitTimeMinutes < minTransit) {
          minTransit = edge.transitTimeMinutes;
        }
      }
      if (minTransit !== Infinity) {
        bound += minTransit;
      }
    }

    return bound;
  }
}
