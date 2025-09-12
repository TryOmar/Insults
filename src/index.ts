import { Client, GatewayIntentBits } from 'discord.js';
import { config } from './config.js';
import { onReady } from './events/ready.js';
import { handleInteraction } from './events/interactionCreate.js';
import { handleMessage } from './events/messageCreate.js';
import { handleMessageDelete } from './events/messageDelete.js';
import { handleChannelDelete } from './events/channelDelete.js';
import { registerAllCommands } from './utils/registerCommands.js';

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });

client.once('clientReady', async () => {
  onReady(client);
  try {
    await registerAllCommands();
  } catch (err) {
    console.error('Failed to auto-register slash commands:', err);
  }
});
client.on('interactionCreate', handleInteraction);
client.on('messageCreate', handleMessage);
client.on('messageDelete', handleMessageDelete);
client.on('channelDelete', handleChannelDelete);

client.login(config.token);


