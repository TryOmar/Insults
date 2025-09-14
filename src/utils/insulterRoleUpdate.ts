import { Guild } from 'discord.js';
import { updateInsulterRole } from '../services/insulterRole.js';

/**
 * Update the insulter role after a mutating command
 * This is a wrapper that handles errors gracefully
 */
export async function updateInsulterRoleAfterCommand(guild: Guild | null): Promise<void> {
  if (!guild) {
    return; // No guild, no role update needed
  }

  try {
    await updateInsulterRole(guild);
  } catch (error) {
    console.error('Failed to update insulter role after command:', error);
    // Don't throw - this is a non-critical operation
  }
}
