import { Message } from 'discord.js';
import { handleBotMention, handleDMMessage, scanMessageForInsults } from '../utils/messageHandlers.js';

export async function handleMessage(message: Message) {
  // Ignore bot and system messages
  if (message.author.bot || message.system) return;
  if (!message.client.user) return;

  // Handle bot mentions
  await handleBotMention(message);

  // Handle DM messages
  if (!message.guildId || message.channel.type === 1) {
    await handleDMMessage(message);
    return; // Don't process radar for DM messages
  }

  // Auto-scan radar for insults
  try {
    await scanMessageForInsults(message);
  } catch (err) {
    // swallow radar errors to avoid spam
    // console.warn('[radar] error while scanning', err);
  }
}
