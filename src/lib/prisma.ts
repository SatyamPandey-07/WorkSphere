import { PrismaClient } from "@prisma/client";
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { recordQueryDuration } from "@/lib/dbTelemetry";

const globalForPrisma = globalThis as unknown as {
  prisma: ReturnType<typeof createPrismaClient> | undefined;
};

// Prisma 7 requires a driver adapter for PostgreSQL
function createPrismaClient() {
  const connectionString =
    process.env.DATABASE_URL ||
    "postgresql://dummy:dummy@localhost:5432/dummy";
  const pool = new Pool({
    connectionString,
    max: 20,
    min: 2,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 10_000,
  });
  const adapter = new PrismaPg(pool);

  // Client extension (Prisma 7 replacement for the old $use middleware)
  // records per-query duration for the admin system-telemetry dashboard.
  return new PrismaClient({ adapter }).$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const start = performance.now();
          try {
            return await query(args);
          } finally {
            recordQueryDuration(model ?? operation, performance.now() - start);
          }
        },
      },
    },
  });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
