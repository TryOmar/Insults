import { prisma } from '../database/client.js';

/**
 * Archive-related raw SQL queries
 * All queries use parameterized raw SQL to handle Unicode and special characters safely
 */

/**
 * Safely counts archived records with conditions
 */
export async function safeCountArchives(guildId: string, conditions: {
  userId?: string;
  blamerId?: string;
  unblamerId?: string;
  role?: 'insulted' | 'blamer' | 'unblamer';
} = {}): Promise<number> {
  let whereClause = 'WHERE "guildId" = $1';
  const params: any[] = [guildId];
  let paramIndex = 2;

  if (conditions.userId && conditions.role) {
    if (conditions.role === 'insulted') {
      whereClause += ` AND "userId" = $${paramIndex}`;
      params.push(conditions.userId);
      paramIndex++;
    } else if (conditions.role === 'blamer') {
      whereClause += ` AND "blamerId" = $${paramIndex}`;
      params.push(conditions.userId);
      paramIndex++;
    } else if (conditions.role === 'unblamer') {
      whereClause += ` AND "unblamerId" = $${paramIndex}`;
      params.push(conditions.userId);
      paramIndex++;
    }
  } else if (conditions.userId) {
    whereClause += ` AND ("userId" = $${paramIndex} OR "blamerId" = $${paramIndex} OR "unblamerId" = $${paramIndex})`;
    params.push(conditions.userId);
    paramIndex++;
  }

  const result = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*) as count FROM "Archive" ${whereClause}`,
    ...params
  ) as Array<{ count: bigint }>;
  
  return Number(result[0]?.count || 0);
}

/**
 * Safely finds archived records with pagination
 */
export async function safeFindArchivesWithPagination(
  guildId: string,
  page: number,
  pageSize: number,
  conditions: {
    userId?: string;
    blamerId?: string;
    unblamerId?: string;
    role?: 'insulted' | 'blamer' | 'unblamer';
  } = {}
) {
  let whereClause = 'WHERE "guildId" = $1';
  const params: any[] = [guildId];
  let paramIndex = 2;

  if (conditions.userId && conditions.role) {
    if (conditions.role === 'insulted') {
      whereClause += ` AND "userId" = $${paramIndex}`;
      params.push(conditions.userId);
      paramIndex++;
    } else if (conditions.role === 'blamer') {
      whereClause += ` AND "blamerId" = $${paramIndex}`;
      params.push(conditions.userId);
      paramIndex++;
    } else if (conditions.role === 'unblamer') {
      whereClause += ` AND "unblamerId" = $${paramIndex}`;
      params.push(conditions.userId);
      paramIndex++;
    }
  } else if (conditions.userId) {
    whereClause += ` AND ("userId" = $${paramIndex} OR "blamerId" = $${paramIndex} OR "unblamerId" = $${paramIndex})`;
    params.push(conditions.userId);
    paramIndex++;
  }

  const offset = (page - 1) * pageSize;

  const result = await prisma.$queryRawUnsafe(
    `SELECT * FROM "Archive" ${whereClause} ORDER BY "createdAt" DESC, "id" DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
    ...params,
    pageSize,
    offset
  ) as Array<{
    id: number;
    originalInsultId: number;
    guildId: string;
    userId: string;
    blamerId: string;
    insult: string;
    note: string | null;
    createdAt: Date;
    unblamerId: string;
    unblamedAt: Date;
  }>;
  
  return result;
}

/**
 * Safely finds an archive by original insult ID
 */
export async function safeFindArchiveByOriginalInsultId(originalInsultId: number) {
  const result = await prisma.$queryRawUnsafe(
    'SELECT * FROM "Archive" WHERE "originalInsultId" = $1 LIMIT 1',
    originalInsultId
  ) as Array<{
    id: number;
    originalInsultId: number;
    guildId: string;
    userId: string;
    blamerId: string;
    insult: string;
    note: string | null;
    createdAt: Date;
    unblamerId: string;
    unblamedAt: Date;
  }>;
  
  return result[0] || null;
}

/**
 * Safely creates an archive record
 */
export async function safeCreateArchive(data: {
  originalInsultId: number;
  guildId: string;
  userId: string;
  blamerId: string;
  insult: string;
  note: string | null;
  createdAt: Date;
  unblamerId: string;
}) {
  const result = await prisma.$queryRawUnsafe(
    `INSERT INTO "Archive" ("originalInsultId", "guildId", "userId", "blamerId", "insult", "note", "createdAt", "unblamerId") 
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) 
     RETURNING *`,
    data.originalInsultId,
    data.guildId,
    data.userId,
    data.blamerId,
    data.insult,
    data.note,
    data.createdAt,
    data.unblamerId
  ) as Array<{
    id: number;
    originalInsultId: number;
    guildId: string;
    userId: string;
    blamerId: string;
    insult: string;
    note: string | null;
    createdAt: Date;
    unblamerId: string;
    unblamedAt: Date;
  }>;
  
  return result[0];
}
