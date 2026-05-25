import { Guild } from 'discord.js';
import { guildSetupService } from '../services/guildSetup.js';

/**
 * Event handler for when the bot joins a new guild (server)
 */
export async function handleGuildCreate(guild: Guild) {
  console.log(`📥 Bot joined a new guild: ${guild.name} (${guild.id})`);
  try {
    await guildSetupService.ensureGuildSetup(guild.id, guild.name);
  } catch (error) {
    console.error(`❌ Error setting up guild ${guild.name} (${guild.id}) on join:`, error);
  }
}
