import { REST, Routes } from 'discord.js';
import { config } from '../config.js';
import { data as blame } from '../commands/blame.js';
import { data as rank } from '../commands/rank.js';
import { data as detail } from '../commands/detail.js';
import { data as unblame } from '../commands/unblame.js';
import { data as help } from '../commands/help.js';
import { data as history } from '../commands/history.js';
import { data as insults } from '../commands/insults.js';
import { data as radar } from '../commands/radar.js';
import { data as archive } from '../commands/archive.js';
import { data as revert } from '../commands/revert.js';
import { data as clear } from '../commands/clear.js';

export async function registerAllCommands(guilds?: Map<string, any>) {
  const rest = new REST({ version: '10' }).setToken(config.token);
  const commandJson = [blame, rank, detail, unblame, help, history, insults, radar, archive, revert, clear].map((c) => c.toJSON());

  console.log('— Slash Command Registration —');
  console.log(`Client ID: ${config.clientId}`);
  console.log(`Commands to register: ${commandJson.length}`);

  // If no guilds provided, check for DEV_GUILD_ID for backward compatibility
  if (!guilds || guilds.size === 0) {
    const devGuildId = process.env.DEV_GUILD_ID;
    if (devGuildId) {
      console.log(`DEV_GUILD_ID: ${devGuildId} (development mode)`);
      const route = Routes.applicationGuildCommands(config.clientId, devGuildId);
      console.log(`Route: PUT ${route}`);
      const res = (await rest.put(route, { body: commandJson })) as unknown as any[];
      console.log(`Registered GUILD slash commands for dev guild ${devGuildId}. API response items: ${Array.isArray(res) ? res.length : 'unknown'}`);
    } else {
      console.log(`DEV_GUILD_ID: (none, using GLOBAL)`);
      const route = Routes.applicationCommands(config.clientId);
      console.log(`Route: PUT ${route}`);
      const res = (await rest.put(route, { body: commandJson })) as unknown as any[];
      console.log(`Registered GLOBAL slash commands. API response items: ${Array.isArray(res) ? res.length : 'unknown'}`);
    }
    return;
  }

  // Register commands for each guild
  console.log(`Registering commands for ${guilds.size} guild(s)`);
  let successCount = 0;
  
  for (const [guildId, guild] of guilds) {
    try {
      const route = Routes.applicationGuildCommands(config.clientId, guildId);
      console.log(`Route: PUT ${route} (${guild.name})`);
      const res = (await rest.put(route, { body: commandJson })) as unknown as any[];
      console.log(`✅ Registered commands for guild: ${guild.name} (${guildId}). API response items: ${Array.isArray(res) ? res.length : 'unknown'}`);
      successCount++;
    } catch (error) {
      console.error(`❌ Failed to register commands for guild: ${guild.name} (${guildId}):`, error);
    }
  }
  
  console.log(`🎉 Command registration completed (${successCount}/${guilds.size} successful)`);
}

// Allow running directly: npx tsx src/utils/registerCommands.ts
if (import.meta.url === `file://${process.argv[1]}`) {
  // Only register commands if REGISTER_COMMANDS environment variable is set
  if (process.env.REGISTER_COMMANDS === 'true') {
    registerAllCommands().catch((err) => {
      console.error(err);
      process.exit(1);
    });
  } else {
    console.log('⚠️ REGISTER_COMMANDS not set to "true", skipping command registration');
    console.log('💡 To register commands, run with: REGISTER_COMMANDS=true node dist/utils/registerCommands.js');
    process.exit(0);
  }
}


