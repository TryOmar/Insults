import { ChatInputCommandInteraction, SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, userMention, MessageFlags, ButtonInteraction } from 'discord.js';
import { prisma } from '../database/client.js';
import { PaginationManager, createStandardCustomId, parseStandardCustomId, PaginationData } from '../utils/pagination.js';

const PAGE_SIZE = 10;

async function fetchRankData(guildId: string, page: number, pageSize: number): Promise<PaginationData<{ userId: string; points: number; username: string }>> {
  const [totalCount, rows] = await Promise.all([
    prisma.insult.groupBy({ by: ['userId'], where: { guildId } }).then(rows => rows.length),
    prisma.insult.groupBy({
      by: ['userId'],
      where: { guildId },
      _count: { userId: true },
      orderBy: [{ _count: { userId: 'desc' } }, { userId: 'asc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    })
  ]);

  // Fetch usernames for all users
  const userIds = rows.map(row => row.userId);
  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, username: true }
  });

  const userMap = new Map(users.map(u => [u.id, u.username]));

  const items = rows.map(row => ({
    userId: row.userId,
    points: row._count.userId,
    username: userMap.get(row.userId) || 'Unknown User'
  }));

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  return {
    items,
    totalCount,
    currentPage: page,
    totalPages
  };
}

export const data = new SlashCommandBuilder()
  .setName('rank')
  .setDescription('Show the current insult leaderboard');

function buildRankEmbed(data: PaginationData<{ userId: string; points: number; username: string }>): EmbedBuilder {
  const { items: leaderboardData, currentPage, totalPages } = data;
  
  if (leaderboardData.length === 0) {
    return new EmbedBuilder()
      .setTitle('💀 Insults Leaderboard')
      .setDescription('No insults recorded yet.')
      .setColor(0xDC143C);
  }

  const rankList = leaderboardData.map((item, index) => {
    const rank = (currentPage - 1) * PAGE_SIZE + index + 1;
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

  return new EmbedBuilder()
    .setTitle('💀 Insults Leaderboard')
    .setDescription(rankList)
    .setColor(0xDC143C) // Dark red color for something bad
    .setFooter({ text: `Page ${currentPage}/${totalPages}` })
    .setTimestamp();
}

function createRankPaginationManager(): PaginationManager<{ userId: string; points: number; username: string }> {
  return new PaginationManager(
    {
      pageSize: PAGE_SIZE,
      commandName: 'rank',
      customIdPrefix: 'rank',
      ephemeral: false // Make responses public
    },
    {
      fetchData: async (page: number, pageSize: number, guildId: string) => {
        return await fetchRankData(guildId, page, pageSize);
      },
      buildEmbed: (data: PaginationData<{ userId: string; points: number; username: string }>) => {
        return buildRankEmbed(data);
      },
      buildCustomId: (page: number) => {
        return createStandardCustomId('rank', page);
      },
      parseCustomId: (customId: string) => {
        const parsed = parseStandardCustomId(customId, 'rank');
        if (!parsed) return null;
        return { page: parsed.page };
      }
    }
  );
}

export async function execute(interaction: ChatInputCommandInteraction) {
  const guildId = interaction.guildId;
  if (!guildId) {
    await interaction.reply({ content: 'This command can only be used in a server.', flags: MessageFlags.Ephemeral });
    return;
  }

  const paginationManager = createRankPaginationManager();
  await paginationManager.handleInitialCommand(interaction, guildId);
}

export async function handleButton(customId: string, interaction: ButtonInteraction) {
  if (!customId.startsWith('rank:')) return;
  
  const guildId = interaction.guildId;
  if (!guildId) {
    await interaction.reply({ content: 'This command can only be used in a server.', flags: MessageFlags.Ephemeral });
    return;
  }

  const paginationManager = createRankPaginationManager();
  
  // Handle the button click manually to ensure correct arguments are passed
  const [prefix, action, ...sessionParts] = customId.split(':');
  const fullSessionId = sessionParts.join(':');
  const sessionParsed = parseStandardCustomId(fullSessionId, 'rank');
  if (!sessionParsed) return;
  
  let newPage = sessionParsed.page;
  
  switch (action) {
    case 'first':
      newPage = 1;
      break;
    case 'prev':
      newPage = Math.max(1, sessionParsed.page - 1);
      break;
    case 'next':
      // Get current data to determine total pages
      const currentData = await fetchRankData(guildId, sessionParsed.page, PAGE_SIZE);
      newPage = Math.min(currentData.totalPages, sessionParsed.page + 1);
      break;
    case 'last':
      // Get current data to determine total pages
      const lastData = await fetchRankData(guildId, sessionParsed.page, PAGE_SIZE);
      newPage = lastData.totalPages;
      break;
    case 'refresh':
      newPage = sessionParsed.page; // Stay on current page but refresh data
      break;
    default:
      return;
  }
  
  await paginationManager.respondWithPage(interaction, newPage, false, guildId);
}
