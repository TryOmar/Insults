import { Message } from 'discord.js';
import { prisma } from '../database/client.js';

export async function handleMessageDelete(message: Message) {
  if (!message.guildId) return;
  if (!message.id) return;

  try {
    const setup = await prisma.setup.findUnique({ where: { guildId: message.guildId } });
    if (setup && setup.leaderboardMessageId === message.id) {
      await prisma.setup.delete({ where: { guildId: message.guildId } });
    }
  } catch (err) {
    console.error('[events/messageDelete] cleanup failed:', err);
  }
}


