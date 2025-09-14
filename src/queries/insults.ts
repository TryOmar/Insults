import { prisma, withRetry } from '../database/client.js';
import { createSafeSqlParameter } from '../utils/unicodeHandler.js';

/**
 * Insult-related raw SQL queries
 * All queries use parameterized raw SQL to handle Unicode and special characters safely
 */

/**
 * Safely groups insults by text without breaking SQL queries due to special characters.
 * Uses raw SQL to avoid Prisma's groupBy issues with special characters in insult text.
 * Handles Unicode characters (including Arabic) properly.
 */
export async function safeGroupInsultsByText(guildId: string, userId?: string) {
  // For now, let's use Prisma's groupBy directly since raw SQL is having Unicode issues
  // This is more reliable for Arabic text with special characters
  return withRetry(async () => {
    const where = { guildId, ...(userId ? { userId } : {}) };
    const prismaResult = await prisma.insult.groupBy({
      by: ['insult'],
      where,
      _count: { insult: true },
      orderBy: [{ _count: { insult: 'desc' } }, { insult: 'asc' }]
    });
    
    return prismaResult.map(row => ({
      insult: row.insult,
      _count: { insult: row._count.insult }
    }));
  });
}

/**
 * Safely gets distinct insult count without breaking SQL queries.
 * Handles Unicode characters (including Arabic) properly.
 */
export async function safeGetDistinctInsultCount(guildId: string, userId?: string): Promise<number> {
  return withRetry(async () => {
    const where = { guildId, ...(userId ? { userId } : {}) };
    const result = await prisma.insult.groupBy({
      by: ['insult'],
      where,
      _count: { insult: true }
    });
    
    return result.length;
  });
}

/**
 * Safely groups by blamerId for a specific insult without breaking SQL queries.
 * Handles Unicode characters (including Arabic) properly.
 */
export async function safeGroupByBlamerForInsult(guildId: string, insult: string) {
  try {
    const prismaResult = await prisma.insult.groupBy({
      by: ['blamerId'],
      where: { guildId, insult },
      _count: { blamerId: true },
      orderBy: [{ _count: { blamerId: 'desc' } }, { blamerId: 'asc' }],
      take: 1
    });
    
    return prismaResult.map(row => ({
      blamerId: row.blamerId,
      _count: { blamerId: row._count.blamerId }
    }));
  } catch (error) {
    console.error('Error in safeGroupByBlamerForInsult:', error);
    throw error;
  }
}

/**
 * Safely finds the first insult record for a specific insult text.
 * Handles Unicode characters (including Arabic) properly.
 */
export async function safeFindFirstInsult(guildId: string, insult: string, orderBy: 'asc' | 'desc' = 'asc') {
  try {
    const orderByClause = orderBy === 'asc' 
      ? [{ createdAt: 'asc' as const }, { id: 'asc' as const }]
      : [{ createdAt: 'desc' as const }, { id: 'desc' as const }];
      
    const result = await prisma.insult.findFirst({
      where: { guildId, insult },
      orderBy: orderByClause,
      select: { blamerId: true }
    });
    
    return result;
  } catch (error) {
    console.error('Error in safeFindFirstInsult:', error);
    throw error;
  }
}

/**
 * Safely counts total insults for a guild
 */
export async function safeCountInsults(guildId: string): Promise<number> {
  return withRetry(async () => {
    const result = await prisma.$queryRawUnsafe(
      'SELECT COUNT(*) as count FROM "Insult" WHERE "guildId" = $1',
      guildId
    ) as Array<{ count: bigint }>;
    
    return Number(result[0]?.count || 0);
  });
}

/**
 * Safely counts insults with specific conditions
 */
export async function safeCountInsultsWithConditions(guildId: string, conditions: {
  userId?: string;
  insult?: string;
  blamerId?: string;
}): Promise<number> {
  let whereClause = 'WHERE "guildId" = $1';
  const params: any[] = [guildId];
  let paramIndex = 2;

  if (conditions.userId) {
    whereClause += ` AND "userId" = $${paramIndex}`;
    params.push(conditions.userId);
    paramIndex++;
  }

  if (conditions.insult) {
    whereClause += ` AND "insult" = $${paramIndex}`;
    params.push(conditions.insult);
    paramIndex++;
  }

  if (conditions.blamerId) {
    whereClause += ` AND "blamerId" = $${paramIndex}`;
    params.push(conditions.blamerId);
    paramIndex++;
  }

  const result = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*) as count FROM "Insult" ${whereClause}`,
    ...params
  ) as Array<{ count: bigint }>;
  
  return Number(result[0]?.count || 0);
}

/**
 * Safely finds insults with pagination and ordering
 */
export async function safeFindInsultsWithPagination(
  guildId: string, 
  page: number, 
  pageSize: number,
  conditions: {
    userId?: string;
    insult?: string;
  } = {},
  orderBy: 'asc' | 'desc' = 'desc'
) {
  let whereClause = 'WHERE "guildId" = $1';
  const params: any[] = [guildId];
  let paramIndex = 2;

  if (conditions.userId) {
    whereClause += ` AND "userId" = $${paramIndex}`;
    params.push(conditions.userId);
    paramIndex++;
  }

  if (conditions.insult) {
    whereClause += ` AND "insult" = $${paramIndex}`;
    params.push(conditions.insult);
    paramIndex++;
  }

  const orderDirection = orderBy === 'asc' ? 'ASC' : 'DESC';
  const offset = (page - 1) * pageSize;

  const result = await prisma.$queryRawUnsafe(
    `SELECT * FROM "Insult" ${whereClause} ORDER BY "createdAt" ${orderDirection}, "id" ${orderDirection} LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
    ...params,
    pageSize,
    offset
  ) as Array<{
    id: number;
    guildId: string;
    userId: string;
    blamerId: string;
    insult: string;
    note: string | null;
    createdAt: Date;
  }>;
  
  return result;
}

/**
 * Safely finds a specific insult by ID
 */
export async function safeFindInsultById(id: number, guildId?: string) {
  let whereClause = 'WHERE "id" = $1';
  const params: any[] = [id];

  if (guildId) {
    whereClause += ' AND "guildId" = $2';
    params.push(guildId);
  }

  const result = await prisma.$queryRawUnsafe(
    `SELECT * FROM "Insult" ${whereClause} LIMIT 1`,
    ...params
  ) as Array<{
    id: number;
    guildId: string;
    userId: string;
    blamerId: string;
    insult: string;
    note: string | null;
    createdAt: Date;
  }>;
  
  return result[0] || null;
}

/**
 * Safely gets distinct user count for a specific insult
 */
export async function safeGetDistinctUserCountForInsult(guildId: string, insult: string): Promise<number> {
  const result = await prisma.$queryRawUnsafe(
    'SELECT COUNT(DISTINCT "userId") as count FROM "Insult" WHERE "guildId" = $1 AND "insult" = $2',
    guildId,
    insult
  ) as Array<{ count: bigint }>;
  
  return Number(result[0]?.count || 0);
}

/**
 * Safely gets top insulter for a specific insult
 */
export async function safeGetTopInsulterForInsult(guildId: string, insult: string) {
  const result = await prisma.$queryRawUnsafe(
    'SELECT "userId", COUNT(*) as count FROM "Insult" WHERE "guildId" = $1 AND "insult" = $2 GROUP BY "userId" ORDER BY count DESC, "userId" ASC LIMIT 1',
    guildId,
    insult
  ) as Array<{ userId: string; count: bigint }>;
  
  return result[0] || null;
}
