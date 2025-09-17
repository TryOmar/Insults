import { GuildMember, Role } from 'discord.js';
import { prisma } from '../database/client.js';

export interface RoleCheckResult {
  allowed: boolean;
  reason?: string;
}

/**
 * Check if a user can use mutating commands (blame, unblame, revert, radar, archive)
 */
export async function canUseMutatingCommands(member: GuildMember, setup?: any): Promise<RoleCheckResult> {
  // If no blamer role is set, all users can use mutating commands
  if (!setup?.blamerRoleId) {
    return { allowed: true };
  }

  // Check if user has the blamer role
  const hasBlamerRole = member.roles.cache.has(setup.blamerRoleId);
  if (hasBlamerRole) {
    return { allowed: true };
  }

  return { 
    allowed: false, 
    reason: `You need the <@&${setup.blamerRoleId}> role to use this command.` 
  };
}

/**
 * Check if a user is frozen (blocked from using any bot commands)
 */
export async function isUserFrozen(member: GuildMember, setup?: any): Promise<RoleCheckResult> {
  // If no frozen role is set, no users are blocked
  if (!setup?.frozenRoleId) {
    return { allowed: true };
  }

  // Check if user has the frozen role
  const hasFrozenRole = member.roles.cache.has(setup.frozenRoleId);
  if (hasFrozenRole) {
    return { 
      allowed: false, 
      reason: `You have the <@&${setup.frozenRoleId}> role and cannot use bot commands.` 
    };
  }

  return { allowed: true };
}

/**
 * Check if a user can use any bot command (combines frozen check with mutating check)
 * This function now fetches setup data once and passes it to the other functions
 */
export async function canUseBotCommands(member: GuildMember, isMutatingCommand: boolean = false): Promise<RoleCheckResult> {
  // Fetch setup data once
  const setup = await prisma.setup.findUnique({ 
    where: { guildId: member.guild.id },
    select: {
      blamerRoleId: true,
      frozenRoleId: true
    }
  });

  // First check if user is frozen
  const frozenCheck = await isUserFrozen(member, setup);
  if (!frozenCheck.allowed) {
    return frozenCheck;
  }

  // If it's a mutating command, check blamer role
  if (isMutatingCommand) {
    return await canUseMutatingCommands(member, setup);
  }

  // For non-mutating commands, just check if not frozen
  return { allowed: true };
}

/**
 * Get the current top insulter for a guild based on blame counts
 */
export async function getTopInsulter(guildId: string, days: number = 0): Promise<{ userId: string; count: number } | null> {
  const whereClause: any = { guildId };
  
  // Add date filter if days > 0
  if (days > 0) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);
    whereClause.createdAt = { gte: cutoffDate };
  }

  const result = await prisma.insult.groupBy({
    by: ['userId'],
    where: whereClause,
    _count: { userId: true },
    orderBy: { _count: { userId: 'desc' } },
    take: 1
  });

  if (result.length === 0) {
    return null;
  }

  return {
    userId: result[0].userId,
    count: result[0]._count.userId
  };
}

/**
 * Update the insulter role for a guild
 */
export async function updateInsulterRole(guildId: string): Promise<void> {
  const setup = await prisma.setup.findUnique({
    where: { guildId }
  });

  if (!(setup as any)?.insulterRoleId) {
    return; // Auto-assignment is disabled
  }

  const topInsulter = await getTopInsulter(guildId, (setup as any).insulterDays);
  
  if (!topInsulter) {
    return; // No insults found
  }

  // Get the guild and role
  const guild = await prisma.$queryRaw`
    SELECT id FROM "Guild" WHERE id = ${guildId}
  `.catch(() => null);
  
  if (!guild) {
    return; // Guild not found
  }

  // This would need to be implemented with Discord API calls
  // For now, we'll just log the information
  console.log(`Top insulter for guild ${guildId}: ${topInsulter.userId} with ${topInsulter.count} insults`);
}
