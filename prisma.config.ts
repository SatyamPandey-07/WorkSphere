import path from "node:path";
import { defineConfig, env } from "prisma/config";
import { config } from "dotenv";

// Load environment variables from .env.local if present
config({ path: ".env.local" });

let dbUrl =
  process.env.DATABASE_URL || "postgresql://dummy:dummy@localhost:5432/dummy";
try {
  const resolved = env("DATABASE_URL");
  if (resolved) dbUrl = resolved;
} catch {
  // Use fallback URL for client generation when DATABASE_URL is not set
}

export default defineConfig({
  schema: path.join("prisma", "schema.prisma"),

  migrations: {
    path: path.join("prisma", "migrations"),
    seed: "node prisma/seed.js",
  },

  datasource: {
    url: dbUrl,
  },
});
