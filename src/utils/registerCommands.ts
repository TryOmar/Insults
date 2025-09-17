import { REST, Routes } from 'discord.js';
import { config } from '../config.js';
import { data as blame } from '../commands/blame.js';
import { data as rank } from '../commands/rank.js';
import { data as detail } from '../commands/detail.js';
import { data as unblame } from '../commands/unblame.js';
import { data as help } from '../commands/help.js';
import { data as history } from '../commands/history.js';
import { data as insults } from '../commands/insults.js';
import { data as archive } from '../commands/archive.js';
import { data as revert } from '../commands/revert.js';
import { data as clear } from '../commands/clear.js';
import { data as configCommand } from '../commands/config.js';
import { data as blameMessageContext } from '../commands/blameMessageContext.js';

export async function registerAllCommands(guilds?: Map<string, any>) {
  const rest = new REST({ version: '10' }).setToken(config.token);
  const commandJson = [blame, rank, detail, unblame, help, history, insults, archive, revert, clear, configCommand, blameMessageContext].map((c) => c.toJSON());

  console.log('— Slash Command Registration —');
  console.log(`Client ID: ${config.clientId}`);
  console.log(`Commands to register: ${commandJson.length}`);

  // Always use GLOBAL registration - delete existing commands first, then register new ones
  console.log(`Using GLOBAL registration`);
  
  try {
    // First, get and delete existing global commands
    console.log('🧹 Cleaning up existing global commands...');
    const existingCommands = (await rest.get(Routes.applicationCommands(config.clientId))) as any[];
    console.log(`Found ${existingCommands.length} existing global commands`);
    
    if (existingCommands.length > 0) {
      console.log(`🗑️ Deleting ${existingCommands.length} existing global commands...`);
      for (const command of existingCommands) {
        try {
          await rest.delete(Routes.applicationCommand(config.clientId, command.id));
          console.log(`  ✅ Deleted: ${command.name}`);
        } catch (error: any) {
          console.error(`  ❌ Failed to delete ${command.name}:`, error.message);
        }
      }
      console.log(`✅ Cleanup completed for global commands`);
    } else {
      console.log(`✅ No existing global commands to clean up`);
    }
    
    // Now register new commands
    console.log('📝 Registering new global commands...');
    const route = Routes.applicationCommands(config.clientId);
    console.log(`Route: PUT ${route}`);
    const res = (await rest.put(route, { body: commandJson })) as unknown as any[];
    console.log(`✅ Registered GLOBAL slash commands. API response items: ${Array.isArray(res) ? res.length : 'unknown'}`);
    
  } catch (error: any) {
    console.error(`❌ Failed to register global commands:`, error.message);
    throw error;
  }
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


