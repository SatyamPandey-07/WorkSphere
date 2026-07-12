# Database Connection Pooling & Serverless Optimizations

In a serverless environment (e.g., Vercel), functions are ephemeral and stateless. Without proper optimization, rapid scaling can exhaust database connection limits instantly. This document outlines best practices for managing Prisma connection pools, configuring PgBouncer with Neon.tech, and ensuring proper client reuse.

---

## 1. Prisma Client Reuse (Global Instance)

Because serverless environments frequently instantiate and destroy hot cloud environments, executing `new PrismaClient()` at the file level will re-create database connections on every single hot invocation.

### Recommended Implementation (`src/lib/db.ts` or `src/lib/prisma.ts`)

Always attach your Prisma Client instance to the Node.js global object in development to prevent hot-reloading from breaking your connection pool.

```typescript
import { PrismaClient } from '@prisma/client';

const prismaClientSingleton = () => {
  return new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  });
};

declare global {
  var prismaGlobal: undefined | ReturnType<typeof prismaClientSingleton>;
}

const prisma = globalThis.prismaGlobal ?? prismaClientSingleton();

export default prisma;

if (process.env.NODE_ENV !== 'production') globalThis.prismaGlobal = prisma;
