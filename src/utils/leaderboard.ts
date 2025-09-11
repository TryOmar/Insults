import { EmbedBuilder, userMention } from 'discord.js';
import { prisma } from '../database/client.js';
import { renderTable, TableConfig } from './tableRenderer.js';

export async function buildLeaderboardEmbed(guildId: string): Promise<EmbedBuilder | null> {
  const rows = await prisma.insult.groupBy({
    by: ['userId'],
    where: { guildId },
    _count: { userId: true },
    orderBy: [{ _count: { userId: 'desc' } }, { userId: 'asc' }],
    take: 10,
  });

  if (rows.length === 0) return null;

  const headers = ['Rank', 'User', 'Count'];
  const tableRows = rows.map((r, idx) => [
    String(idx + 1),
    userMention(r.userId),
    String(r._count.userId)
  ]);

  const config: TableConfig = {
    columns: [
      { maxWidth: 3, align: 'right' },   // Rank
      { maxWidth: 20, align: 'left' },   // User
      { maxWidth: 6, align: 'right' }    // Count
    ],
    emptyMessage: 'No ranking data available'
  };
  const table = renderTable(headers, tableRows, config);

  return new EmbedBuilder()
    .setTitle('Insult Leaderboard')
    .setDescription(table);
}
