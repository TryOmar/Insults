import { ActionRowBuilder, ButtonBuilder, ButtonInteraction, ButtonStyle, ChatInputCommandInteraction, EmbedBuilder, SlashCommandBuilder, MessageFlags } from 'discord.js';
import { prisma } from '../database/client.js';
import { renderTable, TableConfig } from '../utils/tableRenderer.js';
import { getShortTime } from '../utils/time.js';
import { PaginationManager, createStandardCustomId, parseStandardCustomId, PaginationData } from '../utils/pagination.js';
import { formatInsultFrequencyPairs } from '../utils/insultFormatter.js';
import { withSpamProtection } from '../utils/commandWrapper.js';
import { safeInteractionReply, getGuildMember } from '../utils/interactionValidation.js';
import { canUseBotCommands } from '../utils/roleValidation.js';

type HistoryScope = { guildId: string; userId?: string | null };

const PAGE_SIZE = 10;

export const data = new SlashCommandBuilder()
  .setName('history')
  .setDescription('Show insult history for a user or the whole server')
  .addUserOption((opt) => opt.setName('user').setDescription('Optional: user to filter by').setRequired(false));

async function executeCommand(interaction: ChatInputCommandInteraction) {
  const guildId = interaction.guildId;
  if (!guildId) {
    await interaction.reply({ content: 'This command can only be used in a server.', flags: MessageFlags.Ephemeral });
    return;
  }

  // Check role permissions
  const member = await getGuildMember(interaction);
  if (!member) {
    await interaction.reply({ content: 'Unable to verify your permissions.', flags: MessageFlags.Ephemeral });
    return;
  }

  const roleCheck = await canUseBotCommands(member, false); // false = non-mutating command
  if (!roleCheck.allowed) {
    await interaction.reply({ content: roleCheck.reason || 'You do not have permission to use this command.', flags: MessageFlags.Ephemeral });
    return;
  }

  const userOpt = interaction.options.getUser('user', false);
  const scope: HistoryScope = { guildId, userId: userOpt?.id ?? null };
  
  // Try to fetch live display name (global name preferred) for title rendering
  let targetDisplayName: string | undefined;
  if (scope.userId) {
    try {
      const user = await interaction.client.users.fetch(scope.userId);
      targetDisplayName = (user as any).globalName ?? user.username;
    } catch {}
  }
  
  const paginationManager = createHistoryPaginationManager();
  await paginationManager.handleInitialCommand(interaction, scope, targetDisplayName);
}

// Export with spam protection
export const execute = withSpamProtection(executeCommand);

async function fetchHistoryData(scope: HistoryScope, page: number, pageSize: number): Promise<PaginationData<any>> {
  try {
    const where = { guildId: scope.guildId, ...(scope.userId ? { userId: scope.userId } : {}) } as any;

    // Use a single transaction to batch all queries
    return await prisma.$transaction(async (tx) => {
      // Get the main data we need in parallel within the transaction
      const [totalCount, entries] = await Promise.all([
        tx.insult.count({ where }),
        tx.insult.findMany({
          where,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
      ]);

      // Get additional data in parallel within the same transaction
      const [distinctUsers, distinctInsults, targetUser] = await Promise.all([
        tx.insult.groupBy({ by: ['userId'], where }).then((g) => g.length),
        tx.insult.groupBy({ by: ['insult'], where, _count: { insult: true } }),
        scope.userId ? tx.user.findUnique({ where: { id: scope.userId }, select: { username: true } }) : null,
      ]);

      // Get all unique user IDs we need to fetch
      const uniqueBlamerIds = Array.from(new Set(entries.map((e) => e.blamerId)));
      const uniqueInsultedIds = Array.from(new Set(entries.map((e) => e.userId)));
      const allUserIds = [...uniqueBlamerIds, ...uniqueInsultedIds];

      // Fetch all users in one query
      const users = allUserIds.length
        ? await tx.user.findMany({ where: { id: { in: allUserIds } }, select: { id: true, username: true } })
        : [];
      const userMap = new Map(users.map((u) => [u.id, u.username]));

      // Create separate maps for blamers and insulted users
      const blamerMap = new Map(uniqueBlamerIds.map(id => [id, userMap.get(id) ?? 'Unknown']));
      const insultedUserMap = new Map(uniqueInsultedIds.map(id => [id, userMap.get(id) ?? 'Unknown']));

      // Build distinct insults summary with counts using the formatter
      const insultGroups = distinctInsults;
      const formattedInsults = formatInsultFrequencyPairs(insultGroups);

      const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

      return {
        items: entries,
        totalCount,
        currentPage: page,
        totalPages,
        // Additional data for the embed
        distinctUsers,
        blamerMap,
        insultedUserMap,
        insultGroups,
        formattedInsults,
        targetUsername: targetUser?.username ?? null
      } as PaginationData<any> & {
        distinctUsers: number;
        blamerMap: Map<string, string>;
        insultedUserMap: Map<string, string>;
        insultGroups: Array<{ insult: string; _count: { insult: number } }>;
        formattedInsults: string;
        targetUsername: string | null;
      };
    });
  } catch (error) {
    // Check if this is a database connection error
    if (error && typeof error === 'object' && 'code' in error && error.code === 'P1001') {
      throw new Error('Database connection failed. Please try again later.');
    }
    // Re-throw other errors
    throw error;
  }
}

function buildHistoryEmbed(data: PaginationData<any> & {
  distinctUsers: number;
  blamerMap: Map<string, string>;
  insultedUserMap: Map<string, string>;
  insultGroups: Array<{ insult: string; _count: { insult: number } }>;
  formattedInsults: string;
  targetUsername: string | null;
}, scope: HistoryScope, serverName: string | undefined, targetDisplayName?: string): EmbedBuilder {
  const { items: entries, totalCount, currentPage, totalPages, distinctUsers, blamerMap, insultedUserMap, insultGroups, formattedInsults, targetUsername } = data;
  
  const headers = scope.userId ? ['ID', 'Blamer', 'Insult'] : ['ID', 'Insulter', 'Insult'];
  const rows = entries.map((e) => [
    String(e.id),
    scope.userId 
      ? `<@${e.blamerId}>`
      : `<@${e.userId}>`,
    e.insult,
  ]);
  const config: TableConfig = {
    columns: [
      { maxWidth: 4 },   // ID
      { maxWidth: 10 },  // Blamer/Insulter
      { maxWidth: 14 },  // Insult
    ],
    emptyMessage: 'No history data to display'
  };
  const table = renderTable(headers, rows, config);

  const title = scope.userId
    ? `📜 History for ${(targetDisplayName || targetUsername) ?? 'Unknown'}`
    : '📜 Server-wide History';
  
  const embed = new EmbedBuilder()
    .setTitle(title)
    .setDescription(table)
    .setFooter({ text: `Page ${currentPage}/${totalPages}` })
    .setTimestamp();

  const fields: { name: string; value: string; inline?: boolean }[] = [];
  if (scope.userId) {
    fields.push({ name: 'User', value: `<@${scope.userId}>`, inline: false });
  }
  fields.push(
    { name: 'Total Blames', value: String(totalCount), inline: true },
  );
  if (!scope.userId) {
    fields.push({ name: 'Total Users', value: String(distinctUsers), inline: true });
  }
  fields.push({ name: 'Total Insults', value: String(insultGroups.length), inline: true });
  fields.push({ name: 'Insults Frequency', value: formattedInsults, inline: false });
  fields.push({ name: '', value: '*Use `/detail <id>` for more info*', inline: false });
  embed.addFields(fields);
  return embed;
}

function createHistoryPaginationManager(): PaginationManager<any, PaginationData<any> & {
  distinctUsers: number;
  blamerMap: Map<string, string>;
  insultedUserMap: Map<string, string>;
  insultGroups: Array<{ insult: string; _count: { insult: number } }>;
  formattedInsults: string;
  targetUsername: string | null;
}> {
  return new PaginationManager(
    {
      pageSize: PAGE_SIZE,
      commandName: 'history',
      customIdPrefix: 'history',
      ephemeral: false // Make history visible to everyone
    },
    {
      fetchData: async (page: number, pageSize: number, scope: HistoryScope) => {
        return await fetchHistoryData(scope, page, pageSize) as PaginationData<any> & {
          distinctUsers: number;
          blamerMap: Map<string, string>;
          insultedUserMap: Map<string, string>;
          insultGroups: Array<{ insult: string; _count: { insult: number } }>;
          formattedInsults: string;
          targetUsername: string | null;
        };
      },
      buildEmbed: (data: PaginationData<any> & {
        distinctUsers: number;
        blamerMap: Map<string, string>;
        insultedUserMap: Map<string, string>;
        insultGroups: Array<{ insult: string; _count: { insult: number } }>;
        formattedInsults: string;
        targetUsername: string | null;
      }, scope: HistoryScope, serverName: string | undefined, targetDisplayName?: string) => {
        return buildHistoryEmbed(data, scope, serverName, targetDisplayName);
      },
      buildCustomId: (page: number, scope: HistoryScope) => {
        const userId = scope.userId ?? 'all';
        return createStandardCustomId('history', page, userId);
      },
      parseCustomId: (customId: string) => {
        const parsed = parseStandardCustomId(customId, 'history');
        if (!parsed) return null;
        const userId = parsed.params[0] === 'all' ? null : parsed.params[0];
        return { page: parsed.page, userId };
      }
    }
  );
}

export async function handleButton(customId: string, interaction: ButtonInteraction) {
  if (!customId.startsWith('history:')) return;
  
  // Extract the session ID from the custom ID
  const parts = customId.split(':');
  if (parts.length < 3) return;
  
  const sessionId = parts.slice(2).join(':'); // Rejoin in case there are colons in the session ID
  const parsed = parseStandardCustomId(sessionId, 'history');
  if (!parsed) return;
  
  const userId = parsed.params[0] === 'all' ? null : parsed.params[0];
  const scope: HistoryScope = { guildId: interaction.guildId as string, userId };
  
  const paginationManager = createHistoryPaginationManager();
  
  // Handle the button click manually to ensure correct arguments are passed
  const [prefix, action, ...sessionParts] = customId.split(':');
  const fullSessionId = sessionParts.join(':');
  const sessionParsed = parseStandardCustomId(fullSessionId, 'history');
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
      // For next, we can safely increment without checking total pages
      // The pagination manager will handle bounds checking
      newPage = sessionParsed.page + 1;
      break;
    case 'last':
      // For last page, we need to get total pages, but we'll do this efficiently
      // by using a lightweight count query instead of fetching all data
      try {
        const where = { guildId: scope.guildId, ...(scope.userId ? { userId: scope.userId } : {}) } as any;
        const totalCount = await prisma.insult.count({ where });
        newPage = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
      } catch (error) {
        console.error('Error fetching total count for last button:', error);
        return; // Exit early if we can't fetch data
      }
      break;
    case 'refresh':
      newPage = sessionParsed.page; // Stay on current page but refresh data
      break;
    default:
      return;
  }
  
  await paginationManager.respondWithPage(interaction, newPage, false, scope, interaction.guild?.name);
}


