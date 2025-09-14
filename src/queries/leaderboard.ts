import { prisma } from '../database/client.js';

/**
 * Leaderboard-related raw SQL queries
 * All queries use parameterized raw SQL to handle Unicode and special characters safely
 */

/**
 * Safely gets leaderboard data with user grouping
 */
export async function safeGetLeaderboardData(guildId: string, limit: number = 10) {
  const result = await prisma.$queryRawUnsafe(
    `SELECT "userId", COUNT(*) as count 
     FROM "Insult" 
     WHERE "guildId" = $1 
     GROUP BY "userId" 
     ORDER BY count DESC, "userId" ASC 
     LIMIT $2`,
    guildId,
    limit
  ) as Array<{ userId: string; count: bigint }>;
  
  return result.map(row => ({
    userId: row.userId,
    _count: { userId: Number(row.count) }
  }));
}
