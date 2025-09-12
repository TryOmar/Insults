import { ActionRowBuilder, ButtonBuilder, ButtonInteraction, ButtonStyle, ChatInputCommandInteraction, EmbedBuilder, SlashCommandBuilder, MessageFlags } from 'discord.js';
import { prisma } from '../database/client.js';
import { renderTable, TableConfig } from '../utils/tableRenderer.js';
import { getShortTime } from '../utils/time.js';
import { PaginationManager, createStandardCustomId, parseStandardCustomId, PaginationData } from '../utils/pagination.js';

type HistoryScope = { guildId: string; userId?: string | null };

const PAGE_SIZE = 10;

export const data = new SlashCommandBuilder()
  .setName('history')
  .setDescription('Show insult history for a user or the whole server')
  .addUserOption((opt) => opt.setName('user').setDescription('Optional: user to filter by').setRequired(false));

export async function execute(interaction: ChatInputCommandInteraction) {
  const guildId = interaction.guildId;
  if (!guildId) {
    await interaction.reply({ content: 'This command can only be used in a server.', flags: MessageFlags.Ephemeral });
    return;
  }

  const userOpt = interaction.options.getUser('user', false);
  const scope: HistoryScope = { guildId, userId: userOpt?.id ?? null };
  
  const paginationManager = createHistoryPaginationManager();
  await paginationManager.handleInitialCommand(interaction, scope);
}

async function fetchHistoryData(scope: HistoryScope, page: number, pageSize: number): Promise<PaginationData<any>> {
  const where = { guildId: scope.guildId, ...(scope.userId ? { userId: scope.userId } : {}) } as any;

  const [totalCount, distinctUsers, distinctInsults, entries, targetUser] = await Promise.all([
    prisma.insult.count({ where }),
    prisma.insult.groupBy({ by: ['userId'], where }).then((g) => g.length),
    prisma.insult.groupBy({ by: ['insult'], where, _count: { insult: true } }),
    prisma.insult.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    scope.userId ? prisma.user.findUnique({ where: { id: scope.userId }, select: { username: true } }) : Promise.resolve(null),
  ]);

  // Fetch blamer usernames
  const uniqueBlamerIds = Array.from(new Set(entries.map((e) => e.blamerId)));
  const blamers = uniqueBlamerIds.length
    ? await prisma.user.findMany({ where: { id: { in: uniqueBlamerIds } }, select: { id: true, username: true } })
    : [];
  const blamerMap = new Map(blamers.map((u) => [u.id, u.username]));

  // Fetch insulted user usernames
  const uniqueInsultedIds = Array.from(new Set(entries.map((e) => e.userId)));
  const insultedUsers = uniqueInsultedIds.length
    ? await prisma.user.findMany({ where: { id: { in: uniqueInsultedIds } }, select: { id: true, username: true } })
    : [];
  const insultedUserMap = new Map(insultedUsers.map((u) => [u.id, u.username]));

  // Build distinct insults summary with counts, sorted by count desc then insult asc
  const insultGroups = distinctInsults
    .sort((a, b) => (b._count.insult - a._count.insult) || a.insult.localeCompare(b.insult))
    .map((g) => `${g.insult}(${g._count.insult})`);

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
    targetUsername: targetUser?.username ?? null
  } as PaginationData<any> & {
    distinctUsers: number;
    blamerMap: Map<string, string>;
    insultedUserMap: Map<string, string>;
    insultGroups: string[];
    targetUsername: string | null;
  };
}

function buildHistoryEmbed(data: PaginationData<any> & {
  distinctUsers: number;
  blamerMap: Map<string, string>;
  insultedUserMap: Map<string, string>;
  insultGroups: string[];
  targetUsername: string | null;
}, scope: HistoryScope, serverName: string | undefined): EmbedBuilder {
  const { items: entries, totalCount, currentPage, totalPages, distinctUsers, blamerMap, insultedUserMap, insultGroups, targetUsername } = data;
  
  const headers = scope.userId ? ['ID', 'Blamer', 'Insult'] : ['ID', 'Insulter', 'Insult'];
  const rows = entries.map((e) => [
    String(e.id),
    scope.userId 
      ? (blamerMap.get(e.blamerId) ?? 'Unknown') // Show blamer when filtering by user
      : (insultedUserMap.get(e.userId) ?? e.userId), // Show insulter when showing all
    e.insult,
  ]);
  const config: TableConfig = {
    columns: [
      { maxWidth: 4 },   // ID
      { maxWidth: 8},  // Blamer/Insulter
      { maxWidth: 14 },  // Insult
    ],
    emptyMessage: 'No history data to display'
  };
  const table = renderTable(headers, rows, config);

  const title = scope.userId
    ? `📜 History for ${targetUsername ? `${targetUsername}` : scope.userId}`
    : '📜 Server-wide History';
  let distinctInsultsLine = insultGroups.length ? insultGroups.join(', ') : '—';
  if (distinctInsultsLine.length > 800) {
    distinctInsultsLine = distinctInsultsLine.slice(0, 800) + ' …';
  }
  const embed = new EmbedBuilder()
    .setTitle(title)
    .setDescription(table)
    .setFooter({ text: `Page ${currentPage}/${totalPages}` })
    .setTimestamp();

  const fields: { name: string; value: string; inline?: boolean }[] = [];
  if (scope.userId) {
    fields.push({ name: 'User', value: `<@${scope.userId}> (${targetUsername ?? scope.userId})`, inline: false });
  }
  fields.push(
    { name: 'Total Blames', value: String(totalCount), inline: true },
  );
  if (!scope.userId) {
    fields.push({ name: 'Total Users', value: String(distinctUsers), inline: true });
  }
  fields.push({ name: 'Total Insults', value: String(insultGroups.length), inline: true });
  fields.push({ name: 'Insults', value: distinctInsultsLine, inline: false });
  embed.addFields(fields);
  return embed;
}

function createHistoryPaginationManager(): PaginationManager<any, PaginationData<any> & {
  distinctUsers: number;
  blamerMap: Map<string, string>;
  insultedUserMap: Map<string, string>;
  insultGroups: string[];
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
          insultGroups: string[];
          targetUsername: string | null;
        };
      },
      buildEmbed: (data: PaginationData<any> & {
        distinctUsers: number;
        blamerMap: Map<string, string>;
        insultedUserMap: Map<string, string>;
        insultGroups: string[];
        targetUsername: string | null;
      }, scope: HistoryScope, serverName: string | undefined) => {
        return buildHistoryEmbed(data, scope, serverName);
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
      // Get current data to determine total pages
      const currentData = await fetchHistoryData(scope, sessionParsed.page, PAGE_SIZE);
      newPage = Math.min(currentData.totalPages, sessionParsed.page + 1);
      break;
    case 'last':
      // Get current data to determine total pages
      const lastData = await fetchHistoryData(scope, sessionParsed.page, PAGE_SIZE);
      newPage = lastData.totalPages;
      break;
    case 'refresh':
      newPage = sessionParsed.page; // Stay on current page but refresh data
      break;
    default:
      return;
  }
  
  await paginationManager.respondWithPage(interaction, newPage, false, scope, interaction.guild?.name);
}


