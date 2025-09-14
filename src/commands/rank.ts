import { ChatInputCommandInteraction, SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, userMention, MessageFlags, ButtonInteraction } from 'discord.js';
import { prisma } from '../database/client.js';
import { PaginationManager, createStandardCustomId, parseStandardCustomId, PaginationData } from '../utils/pagination.js';
import { BlameButton } from '../utils/BlameButton.js';
import { withSpamProtection } from '../utils/commandWrapper.js';

const PAGE_SIZE = 10;

function getDateFilter(days?: number): { createdAt: { gte: Date } } | {} {
  if (days && days > 0) {
    const startDate = new Date();
    startDate.setHours(0, 0, 0, 0); // reset to midnight today
    startDate.setDate(startDate.getDate() - (days - 1));
    return { createdAt: { gte: startDate } };
  }
  
  return {}; // Default to all-time if no days specified or days = 0
}

async function fetchRankData(guildId: string, page: number, pageSize: number, days?: number): Promise<PaginationData<{ userId: string; points: number; username: string; timePeriod: string }>> {
  const dateFilter = getDateFilter(days);
  const whereClause = { guildId, ...dateFilter };
  
  const [totalCount, rows] = await Promise.all([
    prisma.insult.groupBy({ by: ['userId'], where: whereClause }).then(rows => rows.length),
    prisma.insult.groupBy({
      by: ['userId'],
      where: whereClause,
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

  // Determine time period description
  let timePeriod = 'All-time';
  if (days && days > 0) {
    timePeriod = `Last ${days} day${days === 1 ? '' : 's'}`;
  }

  const items = rows.map(row => ({
    userId: row.userId,
    points: row._count.userId,
    username: userMap.get(row.userId) || 'Unknown User',
    timePeriod
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
  .setDescription('Show the current insult leaderboard')
  .addIntegerOption(option =>
    option
      .setName('days')
      .setDescription('Number of days to look back (leave empty or set to 0 for all-time)')
      .setRequired(false)
      .setMinValue(0)
      .setMaxValue(3650) // 10 years max
  );

function buildRankEmbed(data: PaginationData<{ userId: string; points: number; username: string; timePeriod: string }>): EmbedBuilder {
  const { items: leaderboardData, currentPage, totalPages } = data;
  const timePeriod = leaderboardData.length > 0 ? leaderboardData[0].timePeriod : 'All-time';
  
  if (leaderboardData.length === 0) {
    return new EmbedBuilder()
      .setTitle(`💀 Insults Leaderboard (${timePeriod})`)
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
    .setTitle(`💀 Insults Leaderboard (${timePeriod})`)
    .setDescription(rankList)
    .setColor(0xDC143C) // Dark red color for something bad
    .setFooter({ text: `Page ${currentPage}/${totalPages}` })
    .setTimestamp();
}

class RankPaginationManager extends PaginationManager<{ userId: string; points: number; username: string; timePeriod: string }> {
  buildPaginationButtons(page: number, totalPages: number, ...args: any[]): ActionRowBuilder<ButtonBuilder>[] {
    const rows = super.buildPaginationButtons(page, totalPages, ...args);
    
    // Add blame button as a separate row
    const blameRow = new ActionRowBuilder<ButtonBuilder>();
    blameRow.addComponents(BlameButton.createBlameButton());
    
    return [...rows, blameRow];
  }
}

function createRankPaginationManager(days?: number): RankPaginationManager {
  return new RankPaginationManager(
    {
      pageSize: PAGE_SIZE,
      commandName: 'rank',
      customIdPrefix: 'rank',
      ephemeral: false // Make responses public
    },
    {
      fetchData: async (page: number, pageSize: number, guildId: string) => {
        return await fetchRankData(guildId, page, pageSize, days);
      },
      buildEmbed: (data: PaginationData<{ userId: string; points: number; username: string; timePeriod: string }>) => {
        return buildRankEmbed(data);
      },
      buildCustomId: (page: number) => {
        const params: (string | number)[] = [];
        if (days !== undefined) params.push('days', days);
        return createStandardCustomId('rank', page, ...params);
      },
      parseCustomId: (customId: string) => {
        const parsed = parseStandardCustomId(customId, 'rank');
        if (!parsed) return null;
        
        const result: any = { page: parsed.page };
        
        // Parse the additional parameters
        for (let i = 0; i < parsed.params.length; i += 2) {
          const key = parsed.params[i];
          const value = parsed.params[i + 1];
          if (key === 'days') {
            result.days = parseInt(value, 10);
          }
        }
        
        return result;
      }
    }
  );
}

async function executeCommand(interaction: ChatInputCommandInteraction) {
  const guildId = interaction.guildId;
  if (!guildId) {
    await interaction.reply({ content: 'This command can only be used in a server.', flags: MessageFlags.Ephemeral });
    return;
  }

  // Parse command arguments
  const days = interaction.options.getInteger('days') ?? undefined;

  const paginationManager = createRankPaginationManager(days);
  await paginationManager.handleInitialCommand(interaction, guildId);
}

// Export with spam protection
export const execute = withSpamProtection(executeCommand);

export async function handleButton(customId: string, interaction: ButtonInteraction) {
  if (!customId.startsWith('rank:')) return;
  
  const guildId = interaction.guildId;
  if (!guildId) {
    await interaction.reply({ content: 'This command can only be used in a server.', flags: MessageFlags.Ephemeral });
    return;
  }

  // Parse the session ID to get the original parameters
  const [prefix, action, ...sessionParts] = customId.split(':');
  const fullSessionId = sessionParts.join(':');
  const sessionParsed = parseStandardCustomId(fullSessionId, 'rank');
  if (!sessionParsed) return;
  
  // Extract the original parameters
  let days: number | undefined;
  
  for (let i = 0; i < sessionParsed.params.length; i += 2) {
    const key = sessionParsed.params[i];
    const value = sessionParsed.params[i + 1];
    if (key === 'days') {
      days = parseInt(value, 10);
    }
  }

  const paginationManager = createRankPaginationManager(days);
  await paginationManager.handleButton(customId, interaction, guildId);
}
