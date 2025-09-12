import { ChatInputCommandInteraction, SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, userMention, MessageFlags } from 'discord.js';
import { prisma } from '../database/client.js';

const PAGE_SIZE = 10;

function buildPaginationButtons(page: number, totalPages: number): ActionRowBuilder<ButtonBuilder> {
  const row = new ActionRowBuilder<ButtonBuilder>();

  const firstButton = new ButtonBuilder()
    .setCustomId(`rank:first:${page}:${totalPages}`)
    .setLabel('⏮')
    .setStyle(ButtonStyle.Primary)
    .setDisabled(page === 1);

  const prevButton = new ButtonBuilder()
    .setCustomId(`rank:prev:${page}:${totalPages}`)
    .setLabel('◀')
    .setStyle(ButtonStyle.Primary)
    .setDisabled(page === 1);

  const nextButton = new ButtonBuilder()
    .setCustomId(`rank:next:${page}:${totalPages}`)
    .setLabel('▶')
    .setStyle(ButtonStyle.Primary)
    .setDisabled(page === totalPages);

  const lastButton = new ButtonBuilder()
    .setCustomId(`rank:last:${page}:${totalPages}`)
    .setLabel('⏭')
    .setStyle(ButtonStyle.Primary)
    .setDisabled(page === totalPages);

  row.addComponents(firstButton, prevButton, nextButton, lastButton);
  return row;
}

async function fetchLeaderboardData(guildId: string, page: number): Promise<{ userId: string; points: number; username: string }[]> {
  const rows = await prisma.insult.groupBy({
    by: ['userId'],
    where: { guildId },
    _count: { userId: true },
    orderBy: [{ _count: { userId: 'desc' } }, { userId: 'asc' }],
    skip: (page - 1) * PAGE_SIZE,
    take: PAGE_SIZE,
  });

  // Fetch usernames for all users
  const userIds = rows.map(row => row.userId);
  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, username: true }
  });

  const userMap = new Map(users.map(u => [u.id, u.username]));

  return rows.map(row => ({
    userId: row.userId,
    points: row._count.userId,
    username: userMap.get(row.userId) || 'Unknown User'
  }));
}

export const data = new SlashCommandBuilder()
  .setName('rank')
  .setDescription('Show the current insult leaderboard');

export async function execute(interaction: ChatInputCommandInteraction) {
  const guildId = interaction.guildId;
  if (!guildId) {
    await interaction.reply({ content: 'This command can only be used in a server.', flags: MessageFlags.Ephemeral });
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
    let rankText = '';
    if (rank === 1) {
      rankText = '**1st Place:** 💀';
    } else if (rank === 2) {
      rankText = '**2nd Place:** 👎';
    } else if (rank === 3) {
      rankText = '**3rd Place:** 😢';
    } else {
      rankText = `**${rank}.**`;
    }
    const pointsText = item.points === 1 ? 'Point' : 'Points';
    return `${rankText} ${userMention(item.userId)} - ${item.points} ${pointsText}`;
  }).join('\n');

  const embed = new EmbedBuilder()
    .setTitle('💀 Insults Leaderboard')
    .setDescription(rankList)
    .setColor(0xDC143C) // Dark red color for something bad
    .setFooter({ text: `Page ${page}/${totalPages}` })
    .setTimestamp();

  const components = [buildPaginationButtons(page, totalPages)];

  await interaction.reply({ embeds: [embed], components });
}

export async function handleButton(customId: string, interaction: any) {
  if (!customId.startsWith('rank:')) return;
  
  const guildId = interaction.guildId;
  if (!guildId) {
    await interaction.reply({ content: 'This command can only be used in a server.', flags: MessageFlags.Ephemeral });
    return;
  }

  const parts = customId.split(':');
  const action = parts[1]; // first, prev, next, last
  const currentPage = parseInt(parts[2]);
  const totalPages = parseInt(parts[3]);
  
  let newPage = currentPage;
  if (action === 'first') {
    newPage = 1;
  } else if (action === 'prev') {
    newPage = Math.max(1, currentPage - 1);
  } else if (action === 'next') {
    newPage = Math.min(totalPages, currentPage + 1);
  } else if (action === 'last') {
    newPage = totalPages;
  }
  
  const totalCount = await prisma.insult.groupBy({ by: ['userId'], where: { guildId } }).then(rows => rows.length);
  const calculatedTotalPages = Math.ceil(totalCount / PAGE_SIZE);

  const leaderboardData = await fetchLeaderboardData(guildId, newPage);
  if (leaderboardData.length === 0) {
    await interaction.reply({ content: 'No insults recorded yet.', flags: MessageFlags.Ephemeral });
    return;
  }

  const rankList = leaderboardData.map((item, index) => {
    const rank = (newPage - 1) * PAGE_SIZE + index + 1;
    let rankText = '';
    if (rank === 1) {
      rankText = '**1st Place:** 💀';
    } else if (rank === 2) {
      rankText = '**2nd Place:** 👎';
    } else if (rank === 3) {
      rankText = '**3rd Place:** 😢';
    } else {
      rankText = `**${rank}.**`;
    }
    const pointsText = item.points === 1 ? 'Point' : 'Points';
    return `${rankText} ${userMention(item.userId)} - ${item.points} ${pointsText}`;
  }).join('\n');

  const embed = new EmbedBuilder()
    .setTitle('💀 Insults Leaderboard')
    .setDescription(rankList)
    .setColor(0xDC143C) // Dark red color for something bad
    .setFooter({ text: `Page ${newPage}/${calculatedTotalPages}` })
    .setTimestamp();

  const components = [buildPaginationButtons(newPage, calculatedTotalPages)];

  await interaction.update({ embeds: [embed], components });
}
