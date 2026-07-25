import path from 'node:path'
import { defineConfig } from 'prisma/config'

// Load environment variables from .env.local
import { config } from 'dotenv'
config({ path: '.env.local' })

export default defineConfig({
  earlyAccess: true,
  schema: path.join(__dirname, 'prisma', 'schema.prisma'),
  datasource: {
    url: process.env.DATABASE_URL || 'postgresql://dummy:dummy@localhost:5432/dummy'
  },
  migrations: {
    seed: 'node prisma/seed.js'
  },
  migrate: {
    seed: 'node prisma/seed.js',
    adapter: async () => {
      // Dynamic import for postgres adapter
      const { PrismaPg } = await import('@prisma/adapter-pg')
      const { Pool } = await import('pg')
      const connectionString = process.env.DATABASE_URL || 'postgresql://dummy:dummy@localhost:5432/dummy'
      const pool = new Pool({ connectionString })
      return new PrismaPg(pool)
    }
  }
})
