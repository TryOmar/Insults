import { Client, GatewayIntentBits, Partials } from 'discord.js';
import { config } from './config.js';
import { onReady } from './events/ready.js';
import { handleInteraction } from './events/interactionCreate.js';
import { handleMessage } from './events/messageCreate.js';
import { registerAllCommands } from './utils/registerCommands.js';

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.DirectMessages], partials: [Partials.Channel] });

client.once('clientReady', async () => {
  await onReady(client);
  await registerAllCommands(client.guilds.cache);
});
client.on('interactionCreate', handleInteraction);
client.on('messageCreate', handleMessage);

client.login(config.token);


