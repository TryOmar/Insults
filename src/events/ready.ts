import { Client } from 'discord.js';
import { guildSetupService } from '../services/guildSetup.js';

export async function onReady(client: Client) {
  console.log(`Logged in as ${client.user?.tag}`);
  
  // Auto-detect and setup all guilds the bot is in
  try {
    await guildSetupService.setupAllGuilds(client.guilds.cache);
  } catch (error) {
    console.error('❌ Error during guild auto-detection:', error);
  }
}
