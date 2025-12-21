import path from 'node:path'
import { defineConfig } from 'prisma/config'

export default defineConfig({
  earlyAccess: true,
  schema: path.join(__dirname, 'prisma', 'schema.prisma'),
  migrate: {
    adapter: async () => {
      // Dynamic import for postgres adapter
      const { PrismaPg } = await import('@prisma/adapter-pg')
      const { Pool } = await import('pg')
      const pool = new Pool({ connectionString: process.env.DATABASE_URL })
      return new PrismaPg(pool)
    }
  }
})
