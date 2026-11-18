/**
 * @jest-environment node
 *
 * Real PostgreSQL Database Integration Tests (Issue #8440)
 *
 * Validates real PostgreSQL database behavior against a provisioned database:
 * 1. Database constraints (FK constraint enforcement, unique constraint rejection)
 * 2. Transaction behavior (commit durability and rollback atomicity)
 * 3. PostgreSQL-specific functionality and extensions (vector, pg_trgm, postgis)
 * 4. Migration compatibility and schema verification (tables, indexes, extensions)
 *
 * Requirements:
 * - Requires INTEGRATION_DATABASE_URL or DATABASE_URL pointing to a valid PostgreSQL instance.
 * - Skipped safely when connecting to non-database/dummy URLs in mocked unit test runs.
 */

import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const DB_URL =
  process.env.INTEGRATION_DATABASE_URL ||
  (process.env.DATABASE_URL && !process.env.DATABASE_URL.includes("dummy")
    ? process.env.DATABASE_URL
    : undefined);

const describeIfDb = DB_URL ? describe : describe.skip;

describeIfDb("PostgreSQL Database Integration Checks", () => {
  let pool: Pool;
  let prisma: PrismaClient;

  const TEST_PREFIX = `it_pg_${Date.now()}`;
  const TEST_USER_ID = `${TEST_PREFIX}_user`;
  const TEST_USER_EMAIL = `${TEST_PREFIX}@example.com`;

  beforeAll(async () => {
    if (!DB_URL) return;

    pool = new Pool({
      connectionString: DB_URL,
      max: 5,
      connectionTimeoutMillis: 10_000,
    });
    const adapter = new PrismaPg(pool);
    prisma = new PrismaClient({ adapter });

    // Ensure clean state for test run
    await prisma.user.deleteMany({
      where: { id: { startsWith: TEST_PREFIX } },
    });
    await prisma.venue.deleteMany({
      where: { placeId: { startsWith: TEST_PREFIX } },
    });
  });

  afterAll(async () => {
    if (prisma) {
      try {
        await prisma.user.deleteMany({
          where: { id: { startsWith: TEST_PREFIX } },
        });
        await prisma.venue.deleteMany({
          where: { placeId: { startsWith: TEST_PREFIX } },
        });
      } finally {
        await prisma.$disconnect();
      }
    }
    if (pool) {
      await pool.end();
    }
  });

  describe("A. Migration compatibility & schema verification", () => {
    it("confirms required PostgreSQL extensions are active in pg_extension", async () => {
      const res = await pool.query<{ extname: string }>(
        "SELECT extname FROM pg_extension WHERE extname IN ('vector', 'pg_trgm', 'postgis', 'fuzzystrmatch');",
      );
      const activeExtensions = res.rows.map((r) => r.extname);

      expect(activeExtensions).toContain("vector");
      expect(activeExtensions).toContain("pg_trgm");
      expect(activeExtensions).toContain("postgis");
    });

    it("verifies expected core database tables exist", async () => {
      const res = await pool.query<{ tablename: string }>(
        `SELECT tablename FROM pg_catalog.pg_tables
         WHERE schemaname = 'public'
         AND tablename IN ('User', 'Venue', 'Booking', 'VenueSeat', 'CheckIn', '_prisma_migrations');`,
      );
      const tables = res.rows.map((r) => r.tablename);

      expect(tables).toContain("User");
      expect(tables).toContain("Venue");
      expect(tables).toContain("Booking");
      expect(tables).toContain("VenueSeat");
      expect(tables).toContain("_prisma_migrations");
    });

    it("verifies partial unique index on active booking seats exists", async () => {
      const res = await pool.query<{ indexname: string }>(
        `SELECT indexname FROM pg_indexes
         WHERE tablename = 'Booking'
         AND indexname = 'Booking_active_seat_slot_key';`,
      );
      expect(res.rows.length).toBe(1);
      expect(res.rows[0].indexname).toBe("Booking_active_seat_slot_key");
    });
  });

  describe("B. Database constraints enforcement", () => {
    it("enforces foreign key constraints at database level", async () => {
      const nonExistentUserId = `${TEST_PREFIX}_ghost_user`;
      const invalidVenuePlaceId = `${TEST_PREFIX}_ghost_venue`;

      // Attempting to insert a Venue referencing a non-existent User creatorId
      await expect(
        prisma.venue.create({
          data: {
            placeId: invalidVenuePlaceId,
            name: "Ghost Venue",
            category: "cafe",
            address: "Nowhere 123",
            latitude: 37.7749,
            longitude: -122.4194,
            creatorId: nonExistentUserId,
          },
        }),
      ).rejects.toThrow();
    });

    it("enforces unique constraints at database level on User.email", async () => {
      await prisma.user.create({
        data: {
          id: TEST_USER_ID,
          email: TEST_USER_EMAIL,
          firstName: "Postgres",
          lastName: "Tester",
        },
      });

      // Attempt duplicate user with same email
      await expect(
        prisma.user.create({
          data: {
            id: `${TEST_USER_ID}_dup`,
            email: TEST_USER_EMAIL,
            firstName: "Duplicate",
          },
        }),
      ).rejects.toThrow();
    });
  });

  describe("C. Transaction behavior & ACID durability", () => {
    it("successfully commits database changes in a multi-step transaction", async () => {
      const txVenuePlaceId = `${TEST_PREFIX}_tx_commit_venue`;

      await prisma.$transaction(async (tx) => {
        await tx.venue.create({
          data: {
            placeId: txVenuePlaceId,
            name: "Committed Venue",
            category: "coworking",
            address: "Transaction Way 1",
            latitude: 12.9716,
            longitude: 77.5946,
          },
        });
      });

      const found = await prisma.venue.findUnique({
        where: { placeId: txVenuePlaceId },
      });
      expect(found).not.toBeNull();
      expect(found?.name).toBe("Committed Venue");
    });

    it("rolls back all changes when an error occurs inside a transaction", async () => {
      const txRollbackVenueId = `${TEST_PREFIX}_tx_rollback_venue`;

      await expect(
        prisma.$transaction(async (tx) => {
          await tx.venue.create({
            data: {
              placeId: txRollbackVenueId,
              name: "Rollback Venue",
              category: "library",
              address: "Rollback St 2",
              latitude: 12.9716,
              longitude: 77.5946,
            },
          });

          // Deliberate error to trigger rollback
          throw new Error("INTENTIONAL_ROLLBACK_TEST_ERROR");
        }),
      ).rejects.toThrow("INTENTIONAL_ROLLBACK_TEST_ERROR");

      const shouldNotExist = await prisma.venue.findUnique({
        where: { placeId: txRollbackVenueId },
      });
      expect(shouldNotExist).toBeNull();
    });
  });

  describe("D. PostgreSQL extensions functionality", () => {
    it("executes pg_trgm similarity and word_similarity queries", async () => {
      const res = await pool.query<{ sim: number }>(
        "SELECT similarity('WorkSphere Coworking', 'WorkSphere') AS sim;",
      );
      expect(res.rows.length).toBe(1);
      expect(Number(res.rows[0].sim)).toBeGreaterThan(0.3);
    });

    it("executes pgvector vector distance calculation", async () => {
      const res = await pool.query<{ dist: number }>(
        "SELECT ('[1,2,3]'::vector <-> '[1,2,4]'::vector) AS dist;",
      );
      expect(res.rows.length).toBe(1);
      expect(Number(res.rows[0].dist)).toBeCloseTo(1.0, 5);
    });

    it("executes PostGIS spatial geometry and distance calculation", async () => {
      const res = await pool.query<{ distance_meters: number }>(
        `SELECT ST_Distance(
           ST_SetSRID(ST_MakePoint(-74.006, 40.7128), 4326)::geography,
           ST_SetSRID(ST_MakePoint(-73.935242, 40.730610), 4326)::geography
         ) AS distance_meters;`,
      );
      expect(res.rows.length).toBe(1);
      expect(Number(res.rows[0].distance_meters)).toBeGreaterThan(5000);
      expect(Number(res.rows[0].distance_meters)).toBeLessThan(10000);
    });
  });
});
