import { ChatInputCommandInteraction, SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { prisma } from '../database/client.js';

const PAGE_SIZE = 10;

function buildPaginationButtons(page: number, totalPages: number): ActionRowBuilder<ButtonBuilder> {
  const row = new ActionRowBuilder<ButtonBuilder>();

  const firstButton = new ButtonBuilder()
    .setCustomId(`rank:page:1`)
    .setLabel('<<')
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(page === 1);

  const prevButton = new ButtonBuilder()
    .setCustomId(`rank:page:${Math.max(1, page - 1)}`)
    .setLabel('<')
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(page === 1);

  const nextButton = new ButtonBuilder()
    .setCustomId(`rank:page:${Math.min(totalPages, page + 1)}`)
    .setLabel('>')
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(page === totalPages);

  const lastButton = new ButtonBuilder()
    .setCustomId(`rank:page:${totalPages}`)
    .setLabel('>>')
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(page === totalPages);

  row.addComponents(firstButton, prevButton, nextButton, lastButton);
  return row;
}

async function fetchLeaderboardData(guildId: string, page: number): Promise<{ userId: string; points: number }[]> {
  return prisma.insult.groupBy({
    by: ['userId'],
    where: { guildId },
    _count: { userId: true },
    orderBy: [{ _count: { userId: 'desc' } }, { userId: 'asc' }],
    skip: (page - 1) * PAGE_SIZE,
    take: PAGE_SIZE,
  }).then(rows => rows.map(row => ({ userId: row.userId, points: row._count.userId })));
}

export const data = new SlashCommandBuilder()
  .setName('rank')
  .setDescription('Show the current insult leaderboard');

export async function execute(interaction: ChatInputCommandInteraction) {
  const guildId = interaction.guildId;
  if (!guildId) {
    await interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
    return;
  }

  const page = 1; // Default to the first page
  const totalCount = await prisma.insult.groupBy({ by: ['userId'], where: { guildId } }).then(rows => rows.length);
  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  const leaderboardData = await fetchLeaderboardData(guildId, page);
  if (leaderboardData.length === 0) {
    await interaction.reply('No insults recorded yet.');
    return;
  }

  const rankList = leaderboardData.map((item, index) => {
    const rank = (page - 1) * PAGE_SIZE + index + 1;
    const emoji = rank === 1 ? '🏆' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `${rank}.`;
    return `${emoji} ${item.userId} - ${item.points} Points`;
  }).join('\n');

  const embed = new EmbedBuilder()
    .setTitle('Insults Leaderboard')
    .setDescription(rankList)
    .setFooter({ text: `Page ${page}/${totalPages}` });

  const components = [buildPaginationButtons(page, totalPages)];

  await interaction.reply({ embeds: [embed], components });
}
