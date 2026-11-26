interface MockIncidentRow {
  id: string;
  venueId: string;
  amenity: string;
  amenityLabel: string;
  title: string;
  description: string | null;
  status: string;
  severity: string;
  reporterId: string;
  reporterName: string;
  reporterAvatarUrl: string | null;
  areaLocation: string | null;
  confirmationsCount: number;
  resolved: boolean;
  resolvedAt: Date | null;
  createdAt: Date;
  expiresAt: Date;
}

interface MockConfirmationRow {
  id: string;
  incidentId: string;
  userId: string;
  confirmedAt: Date;
}

const incidentStore = new Map<string, MockIncidentRow>();
const confirmationStore = new Map<string, MockConfirmationRow>();
let idCounter = 0;

function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

function createTxClient() {
  return {
    amenityIncident: {
      findMany: jest.fn(async (args: any) => {
        const { where, include, orderBy } = args;
        let rows = Array.from(incidentStore.values()).filter((row) => {
          if (where?.venueId !== undefined && row.venueId !== where.venueId) {
            return false;
          }
          if (
            where?.resolved !== undefined &&
            row.resolved !== where.resolved
          ) {
            return false;
          }
          if (
            where?.expiresAt?.gt !== undefined &&
            !(row.expiresAt > where.expiresAt.gt)
          ) {
            return false;
          }
          return true;
        });

        if (orderBy?.createdAt === "desc") {
          rows = rows.sort(
            (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
          );
        }

        return rows.map((row) => {
          if (!include?.confirmations) return { ...row };
          const confirmations = Array.from(confirmationStore.values())
            .filter((c) => c.incidentId === row.id)
            .sort((a, b) => a.confirmedAt.getTime() - b.confirmedAt.getTime())
            .map((c) => ({ userId: c.userId }));
          return { ...row, confirmations };
        });
      }),
      findFirst: jest.fn(async (args: any) => {
        const { where, include } = args;
        const row = Array.from(incidentStore.values()).find(
          (item) =>
            (where?.id === undefined || item.id === where.id) &&
            (where?.venueId === undefined || item.venueId === where.venueId),
        );
        if (!row) return null;
        if (!include?.confirmations) return { ...row };
        const confirmations = Array.from(confirmationStore.values())
          .filter((c) => c.incidentId === row.id)
          .sort((a, b) => a.confirmedAt.getTime() - b.confirmedAt.getTime())
          .map((c) => ({ userId: c.userId }));
        return { ...row, confirmations };
      }),
      create: jest.fn(async (args: any) => {
        const { data } = args;
        const row: MockIncidentRow = {
          id: nextId("inc"),
          venueId: data.venueId,
          amenity: data.amenity,
          amenityLabel: data.amenityLabel,
          title: data.title,
          description: data.description ?? null,
          status: data.status ?? "DEGRADED",
          severity: data.severity ?? "medium",
          reporterId: data.reporterId,
          reporterName: data.reporterName,
          reporterAvatarUrl: data.reporterAvatarUrl ?? null,
          areaLocation: data.areaLocation ?? null,
          confirmationsCount: data.confirmationsCount ?? 1,
          resolved: data.resolved ?? false,
          resolvedAt: data.resolvedAt ?? null,
          createdAt: data.createdAt ?? new Date(),
          expiresAt: data.expiresAt,
        };
        incidentStore.set(row.id, row);
        return { ...row };
      }),
      updateMany: jest.fn(async (args: any) => {
        const { where, data } = args;
        let count = 0;
        for (const [id, row] of incidentStore.entries()) {
          if (where?.id !== undefined && row.id !== where.id) continue;
          if (where?.venueId !== undefined && row.venueId !== where.venueId) {
            continue;
          }
          if (
            where?.resolved !== undefined &&
            row.resolved !== where.resolved
          ) {
            continue;
          }
          incidentStore.set(id, {
            ...row,
            ...data,
          });
          count += 1;
        }
        return { count };
      }),
      deleteMany: jest.fn(async (args: any) => {
        const { where } = args;
        let count = 0;
        for (const [id, row] of Array.from(incidentStore.entries())) {
          if (
            where?.expiresAt?.lt !== undefined &&
            !(row.expiresAt < where.expiresAt.lt)
          ) {
            continue;
          }
          incidentStore.delete(id);
          for (const [confKey, conf] of Array.from(
            confirmationStore.entries(),
          )) {
            if (conf.incidentId === id) {
              confirmationStore.delete(confKey);
            }
          }
          count += 1;
        }
        return { count };
      }),
    },
    amenityIncidentConfirmation: {
      create: jest.fn(async (args: any) => {
        const { data } = args;
        const uniqueKey = `${data.incidentId}:${data.userId}`;
        if (confirmationStore.has(uniqueKey)) {
          const err = new Error("Unique constraint failed") as Error & {
            code?: string;
          };
          err.code = "P2002";
          throw err;
        }
        const row: MockConfirmationRow = {
          id: nextId("conf"),
          incidentId: data.incidentId,
          userId: data.userId,
          confirmedAt: data.confirmedAt ?? new Date(),
        };
        confirmationStore.set(uniqueKey, row);
        return { ...row };
      }),
      createMany: jest.fn(async (args: any) => {
        const { data, skipDuplicates } = args;
        let count = 0;
        for (const item of data) {
          const uniqueKey = `${item.incidentId}:${item.userId}`;
          if (confirmationStore.has(uniqueKey)) {
            if (skipDuplicates) continue;
            const err = new Error("Unique constraint failed") as Error & {
              code?: string;
            };
            err.code = "P2002";
            throw err;
          }
          confirmationStore.set(uniqueKey, {
            id: nextId("conf"),
            incidentId: item.incidentId,
            userId: item.userId,
            confirmedAt: item.confirmedAt ?? new Date(),
          });
          count += 1;
        }
        return { count };
      }),
      findMany: jest.fn(async (args: any) => {
        const { where, orderBy } = args;
        let rows = Array.from(confirmationStore.values()).filter(
          (item) =>
            where?.incidentId === undefined ||
            item.incidentId === where.incidentId,
        );
        if (orderBy?.confirmedAt === "asc") {
          rows = rows.sort(
            (a, b) => a.confirmedAt.getTime() - b.confirmedAt.getTime(),
          );
        }
        return rows.map((row) => ({ userId: row.userId }));
      }),
    },
  };
}

const mockTxClient = createTxClient();
const mockPrisma = {
  ...mockTxClient,
  $transaction: jest.fn(async (fn: (tx: typeof mockTxClient) => Promise<any>) =>
    fn(mockTxClient),
  ),
};

jest.mock("@/lib/prisma", () => ({
  prisma: mockPrisma,
}));

import {
  AmenityIncidentService,
  amenityIncidentService,
} from "@/lib/venues/amenityIncidentService";

describe("amenityIncidentService", () => {
  beforeEach(() => {
    incidentStore.clear();
    confirmationStore.clear();
    idCounter = 0;
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it("guards against NaN and non-positive ttlHours without throwing RangeError", async () => {
    const incidentWithNan = await amenityIncidentService.reportIncident({
      venueId: "venue-test",
      amenity: "wifi",
      title: "Wi-Fi down",
      userId: "u-1",
      userName: "Alice",
      ttlHours: NaN,
    });
    expect(incidentWithNan.expiresAt).toBeDefined();
    expect(new Date(incidentWithNan.expiresAt).getTime()).not.toBeNaN();

    const incidentWithNegative = await amenityIncidentService.reportIncident({
      venueId: "venue-test",
      amenity: "coffee",
      title: "Espresso machine broken",
      userId: "u-2",
      userName: "Bob",
      ttlHours: -2,
    });
    expect(new Date(incidentWithNegative.expiresAt).getTime()).toBeGreaterThan(
      Date.now(),
    );
  });

  it("shares reported incidents across independent service instances and simulated restarts", async () => {
    const instanceA = new AmenityIncidentService();
    const instanceB = new AmenityIncidentService();

    const created = await instanceA.reportIncident({
      venueId: "venue-shared",
      amenity: "outlets",
      title: "Wall outlets tripped",
      severity: "critical",
      status: "OUTAGE",
      areaLocation: "North mezzanine",
      userId: "user-a",
      userName: "Alice",
    });

    const statusOnB = await instanceB.getVenueStatus("venue-shared", "user-b");
    expect(statusOnB.activeIncidents).toHaveLength(1);
    expect(statusOnB.activeIncidents[0]).toMatchObject({
      id: created.id,
      venueId: "venue-shared",
      amenity: "outlets",
      title: "Wall outlets tripped",
      status: "OUTAGE",
      severity: "critical",
      areaLocation: "North mezzanine",
      confirmationsCount: 1,
      confirmedUserIds: ["user-a"],
      resolved: false,
    });
    expect(statusOnB.overallHealthPercentage).toBe(88);

    // Re-import service after resetting module registry to simulate a process restart
    let reloadedService: AmenityIncidentService;
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require("@/lib/venues/amenityIncidentService");
      reloadedService = mod.amenityIncidentService;
    });

    const afterRestart = await reloadedService!.getVenueStatus("venue-shared");
    expect(afterRestart.activeIncidents).toHaveLength(1);
    expect(afterRestart.activeIncidents[0].id).toBe(created.id);
  });

  it("deduplicates confirmations per user even under concurrent confirmation calls", async () => {
    const incident = await amenityIncidentService.reportIncident({
      venueId: "venue-confirm",
      amenity: "wifi",
      title: "Packet loss",
      userId: "reporter-1",
      userName: "Reporter",
    });
    const initialExpiry = new Date(incident.expiresAt).getTime();

    // Same user confirming concurrently in parallel should never double count
    const [r1, r2, r3] = await Promise.all([
      amenityIncidentService.confirmIncident(
        "venue-confirm",
        incident.id,
        "user-2",
      ),
      amenityIncidentService.confirmIncident(
        "venue-confirm",
        incident.id,
        "user-2",
      ),
      amenityIncidentService.confirmIncident(
        "venue-confirm",
        incident.id,
        "reporter-1",
      ),
    ]);

    expect(r1).not.toBeNull();
    expect(r2).not.toBeNull();
    expect(r3).not.toBeNull();

    const status = await amenityIncidentService.getVenueStatus("venue-confirm");
    expect(status.activeIncidents[0].confirmationsCount).toBe(2);
    expect(status.activeIncidents[0].confirmedUserIds).toEqual([
      "reporter-1",
      "user-2",
    ]);
    expect(
      new Date(status.activeIncidents[0].expiresAt).getTime(),
    ).toBeGreaterThan(initialExpiry);
  });

  it("persists incident resolution across instances and rejects post-resolution confirmations", async () => {
    const instanceA = new AmenityIncidentService();
    const instanceB = new AmenityIncidentService();

    const incident = await instanceA.reportIncident({
      venueId: "venue-resolve",
      amenity: "coffee",
      title: "Machine descaling",
      userId: "user-1",
      userName: "Alice",
    });

    const resolved = await instanceB.resolveIncident(
      "venue-resolve",
      incident.id,
    );
    expect(resolved).toBe(true);

    const statusOnA = await instanceA.getVenueStatus("venue-resolve");
    expect(statusOnA.activeIncidents).toHaveLength(0);
    expect(statusOnA.overallHealthPercentage).toBe(100);

    const confirmAfterResolve = await instanceA.confirmIncident(
      "venue-resolve",
      incident.id,
      "user-2",
    );
    expect(confirmAfterResolve).toBeNull();

    const resolveMissing = await instanceA.resolveIncident(
      "venue-resolve",
      "missing-id",
    );
    expect(resolveMissing).toBe(false);
  });

  it("excludes expired incidents from active health and cleans up aged audit rows", async () => {
    jest.useFakeTimers();
    const t0 = new Date("2026-11-25T10:00:00.000Z");
    jest.setSystemTime(t0);

    await amenityIncidentService.reportIncident({
      venueId: "venue-ttl",
      amenity: "monitors",
      title: "Flickering USB-C dock",
      userId: "user-1",
      userName: "Alice",
      ttlHours: 1,
    });

    const activeBeforeExpiry =
      await amenityIncidentService.getVenueStatus("venue-ttl");
    expect(activeBeforeExpiry.activeIncidents).toHaveLength(1);
    expect(activeBeforeExpiry.overallHealthPercentage).toBe(94);

    // Advance past 1h TTL (inside 7-day retention window)
    jest.setSystemTime(new Date(t0.getTime() + 90 * 60 * 1000));
    const afterExpiry =
      await amenityIncidentService.getVenueStatus("venue-ttl");
    expect(afterExpiry.activeIncidents).toHaveLength(0);
    expect(afterExpiry.overallHealthPercentage).toBe(100);

    // Retained for audit within default retention window
    expect(await amenityIncidentService.cleanupExpiredIncidents(24 * 7)).toBe(
      0,
    );
    expect(incidentStore.size).toBe(1);

    // Advance past retention window and clean up aged records + cascade confirmations
    jest.setSystemTime(new Date(t0.getTime() + 9 * 24 * 60 * 60 * 1000));
    expect(await amenityIncidentService.cleanupExpiredIncidents(24 * 7)).toBe(
      1,
    );
    expect(incidentStore.size).toBe(0);
    expect(confirmationStore.size).toBe(0);
  });
});
