import { prisma } from '../database/client.js';

/**
 * Setup-related raw SQL queries
 * All queries use parameterized raw SQL to handle Unicode and special characters safely
 */

/**
 * Safely finds setup by guild ID
 */
export async function safeFindSetupByGuildId(guildId: string) {
  const result = await prisma.$queryRawUnsafe(
    'SELECT * FROM "Setup" WHERE "guildId" = $1 LIMIT 1',
    guildId
  ) as Array<{
    guildId: string;
    radarEnabled: boolean;
    createdAt: Date;
  }>;
  
  return result[0] || null;
}

/**
 * Safely creates a setup record
 */
export async function safeCreateSetup(guildId: string, radarEnabled: boolean = false) {
  const result = await prisma.$queryRawUnsafe(
    `INSERT INTO "Setup" ("guildId", "radarEnabled") 
     VALUES ($1, $2) 
     RETURNING *`,
    guildId,
    radarEnabled
  ) as Array<{
    guildId: string;
    radarEnabled: boolean;
    createdAt: Date;
  }>;
  
  return result[0];
}

/**
 * Safely updates setup radar status
 */
export async function safeUpdateSetupRadar(guildId: string, radarEnabled: boolean) {
  const result = await prisma.$queryRawUnsafe(
    `UPDATE "Setup" SET "radarEnabled" = $2 WHERE "guildId" = $1 
     RETURNING *`,
    guildId,
    radarEnabled
  ) as Array<{
    guildId: string;
    radarEnabled: boolean;
    createdAt: Date;
  }>;
  
  return result[0] || null;
}

/**
 * Safely upserts setup (create or update)
 */
export async function safeUpsertSetup(guildId: string, radarEnabled: boolean = false) {
  const result = await prisma.$queryRawUnsafe(
    `INSERT INTO "Setup" ("guildId", "radarEnabled") 
     VALUES ($1, $2) 
     ON CONFLICT ("guildId") DO UPDATE SET "radarEnabled" = $2 
     RETURNING *`,
    guildId,
    radarEnabled
  ) as Array<{
    guildId: string;
    radarEnabled: boolean;
    createdAt: Date;
  }>;
  
  return result[0];
}
