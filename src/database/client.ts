import { PrismaClient } from '@prisma/client';

// Create a single PrismaClient instance for the entire app lifecycle.
// This avoids exhausting DB connections and keeps client reuse predictable.
export const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL,
    },
  },
  // Configure connection pool to prevent connection exhaustion
  // These settings help manage concurrent database operations
  log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
});

// Graceful shutdown handling
process.on('beforeExit', async () => {
  await prisma.$disconnect();
});

process.on('SIGINT', async () => {
  await prisma.$disconnect();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await prisma.$disconnect();
  process.exit(0);
});

export type { Prisma } from '@prisma/client';
