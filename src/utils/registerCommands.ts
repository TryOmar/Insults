import { REST, Routes } from 'discord.js';
import { config } from '../config.js';
import { data as blame } from '../commands/blame.js';
import { data as rank } from '../commands/rank.js';
import { data as live_rank } from '../commands/live_rank.js';
import { data as detail } from '../commands/detail.js';
import { data as unblame } from '../commands/unblame.js';
import { data as form } from '../commands/form.js';
import { data as setup } from '../commands/setup.js';
import { data as help } from '../commands/help.js';
import { data as history } from '../commands/history.js';
import { data as insults } from '../commands/insults.js';

export async function registerAllCommands() {
  const guildId = process.env.DEV_GUILD_ID;
  const rest = new REST({ version: '10' }).setToken(config.token);
  const commandJson = [blame, rank, live_rank, detail, unblame, form, setup, help, history, insults].map((c) => c.toJSON());

  console.log('— Slash Command Registration —');
  console.log(`Client ID: ${config.clientId}`);
  console.log(`DEV_GUILD_ID: ${guildId ?? '(none, using GLOBAL)'}`);
  console.log(`Commands to register: ${commandJson.length}`);

  if (!guildId) {
    const route = Routes.applicationCommands(config.clientId);
    console.log(`Route: PUT ${route}`);
    const res = (await rest.put(route, { body: commandJson })) as unknown as any[];
    console.log(`Registered GLOBAL slash commands. API response items: ${Array.isArray(res) ? res.length : 'unknown'}`);
  } else {
    const route = Routes.applicationGuildCommands(config.clientId, guildId);
    console.log(`Route: PUT ${route}`);
    const res = (await rest.put(route, { body: commandJson })) as unknown as any[];
    console.log(`Registered GUILD slash commands for ${guildId}. API response items: ${Array.isArray(res) ? res.length : 'unknown'}`);
  }
}

// Allow running directly: npx tsx src/utils/registerCommands.ts
if (import.meta.url === `file://${process.argv[1]}`) {
  registerAllCommands().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}


