import { PrismaClient } from '@prisma/client';

// Create a single PrismaClient instance for the entire app lifecycle.
// This avoids exhausting DB connections and keeps client reuse predictable.
export const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL,
    },
  },
  // Add connection timeout and retry configuration
  log: ['error', 'warn'],
});

// Add connection retry logic
export async function withRetry<T>(
  operation: () => Promise<T>,
  maxRetries: number = 3,
  delay: number = 1000
): Promise<T> {
  let lastError: Error;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error: any) {
      lastError = error;
      
      // Only retry on connection errors
      if (error.code === 'P1001' && attempt < maxRetries) {
        console.log(`Database connection attempt ${attempt} failed, retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        delay *= 2; // Exponential backoff
        continue;
      }
      
      throw error;
    }
  }
  
  throw lastError!;
}

export type { Prisma } from '@prisma/client';
