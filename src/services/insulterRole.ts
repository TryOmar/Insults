import { Guild, GuildMember, User } from 'discord.js';
import { prisma } from '../database/client.js';
import { logGameplayAction, logRoleAssignmentIssue } from '../utils/channelLogging.js';

export interface InsulterRoleResult {
  success: boolean;
  newInsulter?: User;
  oldInsulter?: User;
  error?: string;
}

/**
 * Update the insulter role for a guild based on current blame counts
 */
export async function updateInsulterRole(guild: Guild): Promise<InsulterRoleResult> {
  try {
    const setup = await prisma.setup.findUnique({
      where: { guildId: guild.id }
    });

    if (!setup?.insulterRoleId) {
      return { success: true }; // Auto-assignment is disabled
    }

    // Get the current top insulter
    const topInsulter = await getTopInsulter(guild.id, setup.insulterDays);
    
    if (!topInsulter) {
      return { success: true }; // No insults found
    }

    // Get the role
    const role = guild.roles.cache.get(setup.insulterRoleId);
    if (!role) {
      await logRoleAssignmentIssue(
        guild,
        `Insulter role not found`,
        `Role ID: ${setup.insulterRoleId}`
      );
      return { success: false, error: 'Insulter role not found' };
    }

    // Find current members with the insulter role
    const currentInsulterMembers = role.members.map(member => member.id);
    
    // Check if the top insulter already has the role
    if (currentInsulterMembers.includes(topInsulter.userId)) {
      return { success: true }; // Already assigned correctly
    }

    // Get the top insulter as a guild member
    const newInsulterMember = await guild.members.fetch(topInsulter.userId).catch(() => null);
    if (!newInsulterMember) {
      await logRoleAssignmentIssue(
        guild,
        `Top insulter not found in guild`,
        `User ID: ${topInsulter.userId}`
      );
      return { success: false, error: 'Top insulter not found in guild' };
    }

    // Remove role from all current members
    const removePromises = currentInsulterMembers.map(memberId => 
      guild.members.fetch(memberId)
        .then(member => member.roles.remove(role))
        .catch(error => {
          console.error(`Failed to remove insulter role from ${memberId}:`, error);
          return null;
        })
    );

    await Promise.all(removePromises);

    // Add role to new top insulter
    await newInsulterMember.roles.add(role);

    // Get the old insulter for logging
    const oldInsulter = currentInsulterMembers.length > 0 ? 
      await guild.members.fetch(currentInsulterMembers[0]).catch(() => null) : null;

    // Log the role change
    await logGameplayAction(
      guild,
      {
        action: 'insulter-role-update',
        newInsulter: newInsulterMember.user,
        oldInsulter: oldInsulter?.user
      }
    );

    return { 
      success: true, 
      newInsulter: newInsulterMember.user,
      oldInsulter: oldInsulter?.user
    };

  } catch (error) {
    console.error('Failed to update insulter role:', error);
    await logRoleAssignmentIssue(
      guild,
      `Failed to update insulter role`,
      error instanceof Error ? error.message : 'Unknown error'
    );
    return { success: false, error: 'Failed to update insulter role' };
  }
}

/**
 * Get the current top insulter for a guild
 */
async function getTopInsulter(guildId: string, days: number = 0): Promise<{ userId: string; count: number } | null> {
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
 * Check if a user is the current top insulter
 */
export async function isTopInsulter(guildId: string, userId: string, days: number = 0): Promise<boolean> {
  const topInsulter = await getTopInsulter(guildId, days);
  return topInsulter?.userId === userId;
}
