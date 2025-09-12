import { AnyChannel } from 'discord.js';
import { prisma } from '../database/client.js';

export async function handleChannelDelete(channel: AnyChannel) {
  try {
    if (!('guildId' in channel) || !channel.guildId) return;
    const setup = await prisma.setup.findUnique({ where: { guildId: channel.guildId } });
    if (setup && setup.channelId === channel.id) {
      await prisma.setup.delete({ where: { guildId: channel.guildId } });
    }
  } catch (err) {
    console.error('[events/channelDelete] cleanup failed:', err);
  }
}


