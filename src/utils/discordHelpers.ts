import { Client, TextChannel } from 'discord.js';

export function buildMessageLink(guildId: string, channelId: string, messageId: string): string {
  return `https://discord.com/channels/${guildId}/${channelId}/${messageId}`;
}

export async function safeFetchChannel(client: Client, channelId: string): Promise<TextChannel | null> {
  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel || !channel.isTextBased()) return null;
    return channel as TextChannel;
  } catch {
    return null;
  }
}

export async function safeFetchMessage(client: Client, channelId: string, messageId: string) {
  try {
    const channel = await safeFetchChannel(client, channelId);
    if (!channel) return null;
    const msg = await channel.messages.fetch(messageId).catch(() => null);
    return msg ?? null;
  } catch {
    return null;
  }
}


