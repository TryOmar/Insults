import { Client } from 'discord.js';
import { guildSetupService } from '../services/guildSetup.js';
import { registerAllCommands } from '../utils/registerCommands.js';

export async function onReady(client: Client) {
  console.log(`Logged in as ${client.user?.tag}`);
  
  // Auto-detect and setup all guilds the bot is in
  try {
    await guildSetupService.setupAllGuilds(client.guilds.cache);
    
    // Register commands for all detected guilds
    await registerAllCommands(client.guilds.cache);
  } catch (error) {
    console.error('❌ Error during guild auto-detection:', error);
  }
}
