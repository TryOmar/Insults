import { PrismaClient } from '@prisma/client';

// Create a single PrismaClient instance for the entire app lifecycle.
// This avoids exhausting DB connections and keeps client reuse predictable.
export const prisma = new PrismaClient();

export type { Prisma } from '@prisma/client';
