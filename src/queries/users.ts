import { prisma } from '../database/client.js';

/**
 * User-related raw SQL queries
 * All queries use parameterized raw SQL to handle Unicode and special characters safely
 */

/**
 * Safely groups by userId without breaking SQL queries.
 * Handles Unicode characters (including Arabic) properly.
 */
export async function safeGroupByUserId(guildId: string, userId?: string) {
  let result: Array<{ userId: string; count: bigint }>;
  
  if (userId) {
    result = await prisma.$queryRawUnsafe(
      'SELECT "userId", COUNT(*) as count FROM "Insult" WHERE "guildId" = $1 AND "userId" = $2 GROUP BY "userId" ORDER BY count DESC, "userId" ASC',
      guildId,
      userId
    ) as Array<{ userId: string; count: bigint }>;
  } else {
    result = await prisma.$queryRawUnsafe(
      'SELECT "userId", COUNT(*) as count FROM "Insult" WHERE "guildId" = $1 GROUP BY "userId" ORDER BY count DESC, "userId" ASC',
      guildId
    ) as Array<{ userId: string; count: bigint }>;
  }
  
  return result.map(row => ({
    userId: row.userId,
    _count: { userId: Number(row.count) }
  }));
}

/**
 * Safely gets distinct user count without breaking SQL queries.
 */
export async function safeGetDistinctUserCount(guildId: string): Promise<number> {
  const result = await prisma.$queryRawUnsafe(
    'SELECT COUNT(DISTINCT "userId") as count FROM "Insult" WHERE "guildId" = $1',
    guildId
  ) as Array<{ count: bigint }>;
  
  return Number(result[0]?.count || 0);
}

/**
 * Safely finds users by IDs
 */
export async function safeFindUsersByIds(userIds: string[]) {
  if (userIds.length === 0) return [];
  
  const placeholders = userIds.map((_, index) => `$${index + 1}`).join(', ');
  const result = await prisma.$queryRawUnsafe(
    `SELECT "id", "username" FROM "User" WHERE "id" IN (${placeholders})`,
    ...userIds
  ) as Array<{ id: string; username: string }>;
  
  return result;
}

/**
 * Safely finds a user by ID
 */
export async function safeFindUserById(userId: string) {
  const result = await prisma.$queryRawUnsafe(
    'SELECT "id", "username" FROM "User" WHERE "id" = $1 LIMIT 1',
    userId
  ) as Array<{ id: string; username: string }>;
  
  return result[0] || null;
}

/**
 * Safely upserts a user (create or update)
 */
export async function safeUpsertUser(id: string, username: string) {
  const result = await prisma.$queryRawUnsafe(
    `INSERT INTO "User" ("id", "username") VALUES ($1, $2) 
     ON CONFLICT ("id") DO UPDATE SET "username" = $2 
     RETURNING "id", "username"`,
    id,
    username
  ) as Array<{ id: string; username: string }>;
  
  return result[0];
}
