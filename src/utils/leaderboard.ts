import { EmbedBuilder, userMention } from 'discord.js';
import { prisma } from '../database/client.js';

export async function buildLeaderboardEmbed(guildId: string): Promise<EmbedBuilder | null> {
  const rows = await prisma.insult.groupBy({
    by: ['userId'],
    where: { guildId },
    _count: { userId: true },
    orderBy: [{ _count: { userId: 'desc' } }, { userId: 'asc' }],
    take: 10,
  });

  if (rows.length === 0) return null;

  const lines = rows.map((r, idx) => `${idx + 1}. ${userMention(r.userId)} — ${r._count.userId}`);

  return new EmbedBuilder()
    .setTitle('Insult Leaderboard')
    .setDescription(lines.join('\n'));
}
