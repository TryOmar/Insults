import { ChatInputCommandInteraction, SlashCommandBuilder, EmbedBuilder, userMention, MessageFlags, ButtonInteraction } from 'discord.js';
import { prisma } from '../database/client.js';
import { safeCountArchives, safeFindArchivesWithPagination } from '../queries/archives.js';
import { safeFindUsersByIds } from '../queries/users.js';
import { renderTable, TableConfig } from '../utils/tableRenderer.js';
import { getShortTime } from '../utils/time.js';
import { PaginationManager, createStandardCustomId, parseStandardCustomId, PaginationData } from '../utils/pagination.js';
import { withSpamProtection } from '../utils/commandWrapper.js';

const PAGE_SIZE = 10;

export const data = new SlashCommandBuilder()
  .setName('archive')
  .setDescription('Show archived (unblamed) records')
  .addUserOption(opt =>
    opt.setName('user').setDescription('Filter by user involved (insulted/blamer/unblamer)').setRequired(false)
  )
  .addStringOption(opt =>
    opt
      .setName('role')
      .setDescription('Filter by role for the selected user')
      .addChoices(
        { name: 'insulted', value: 'insulted' },
        { name: 'blamer', value: 'blamer' },
        { name: 'unblamer', value: 'unblamer' },
      )
      .setRequired(false)
  );

type ArchiveFilter = {
  guildId: string;
  userId?: string | null;
  role?: 'insulted' | 'blamer' | 'unblamer' | null;
};

async function fetchArchiveData(filter: ArchiveFilter, page: number, pageSize: number): Promise<PaginationData<any>> {
  const conditions = {
    userId: filter.userId || undefined,
    role: filter.role || undefined,
  };

  const [totalCount, entries] = await Promise.all([
    safeCountArchives(filter.guildId, conditions),
    safeFindArchivesWithPagination(filter.guildId, page, pageSize, conditions),
  ]);

  // Fetch usernames for all users involved
  const userIds = [...new Set([
    ...entries.map((e: any) => e.userId),
    ...entries.map((e: any) => e.blamerId),
    ...entries.map((e: any) => e.unblamerId)
  ])];
  
  const users = await safeFindUsersByIds(userIds);
  const userMap = new Map(users.map(u => [u.id, u.username]));

  const items = entries.map((e: any) => [
    `#${e.originalInsultId}`, // Show original insult ID
    e.insult,
    `@${userMap.get(e.unblamerId) ?? e.unblamerId}`,
  ]);

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  return {
    items,
    totalCount,
    currentPage: page,
    totalPages
  };
}

function buildArchiveEmbed(data: PaginationData<any>): EmbedBuilder {
  const { items, currentPage, totalPages } = data;
  
  const headers = ['ID', 'Insult', 'Unblamer'];
  const config: TableConfig = {
    columns: [
      { maxWidth: 6 },  // ID
      { maxWidth: 8 }, // Insult
      { maxWidth: 10 },  // Unblamer
    ],
    emptyMessage: 'No archived records',
  };
  
  const table = renderTable(headers, items, config);
  return new EmbedBuilder()
    .setTitle('🗃️ Archive')
    .setDescription(table)
    .setFooter({ text: `Page ${currentPage}/${totalPages}` })
    .setColor(0x95A5A6)
    .setTimestamp();
}

function createArchivePaginationManager(): PaginationManager<any> {
  return new PaginationManager(
    {
      pageSize: PAGE_SIZE,
      commandName: 'archive',
      customIdPrefix: 'archive',
      ephemeral: false // Make responses public
    },
    {
      fetchData: async (page: number, pageSize: number, filter: ArchiveFilter) => {
        return await fetchArchiveData(filter, page, pageSize);
      },
      buildEmbed: (data: PaginationData<any>) => {
        return buildArchiveEmbed(data);
      },
      buildCustomId: (page: number, filter: ArchiveFilter) => {
        const params = [];
        if (filter.userId) params.push(filter.userId);
        if (filter.role) params.push(filter.role);
        return createStandardCustomId('archive', page, ...params);
      },
      parseCustomId: (customId: string) => {
        const parsed = parseStandardCustomId(customId, 'archive');
        if (!parsed) return null;
        return { 
          page: parsed.page, 
          userId: parsed.params[0] || null,
          role: parsed.params[1] as ('insulted' | 'blamer' | 'unblamer' | null) || null
        };
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

  const user = interaction.options.getUser('user', false);
  const role = interaction.options.getString('role', false) as ('insulted' | 'blamer' | 'unblamer' | null);

  const filter: ArchiveFilter = {
    guildId,
    userId: user?.id ?? null,
    role
  };

  const paginationManager = createArchivePaginationManager();
  await paginationManager.handleInitialCommand(interaction, filter);
}

export async function handleButton(customId: string, interaction: ButtonInteraction) {
  if (!customId.startsWith('archive:')) return;
  
  // Extract the session ID from the custom ID
  const parts = customId.split(':');
  if (parts.length < 3) return;
  
  const sessionId = parts.slice(2).join(':'); // Rejoin in case there are colons in the session ID
  const parsed = parseStandardCustomId(sessionId, 'archive');
  if (!parsed) return;
  
  const guildId = interaction.guildId as string;
  const filter: ArchiveFilter = {
    guildId,
    userId: parsed.params[0] || null,
    role: parsed.params[1] as ('insulted' | 'blamer' | 'unblamer' | null) || null
  };
  
  const paginationManager = createArchivePaginationManager();
  
  // Handle the button click manually to ensure correct arguments are passed
  const [prefix, action, ...sessionParts] = customId.split(':');
  const fullSessionId = sessionParts.join(':');
  const sessionParsed = parseStandardCustomId(fullSessionId, 'archive');
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
      const currentData = await fetchArchiveData(filter, sessionParsed.page, PAGE_SIZE);
      newPage = Math.min(currentData.totalPages, sessionParsed.page + 1);
      break;
    case 'last':
      // Get current data to determine total pages
      const lastData = await fetchArchiveData(filter, sessionParsed.page, PAGE_SIZE);
      newPage = lastData.totalPages;
      break;
    case 'refresh':
      newPage = sessionParsed.page; // Stay on current page but refresh data
      break;
    default:
      return;
  }
  
  await paginationManager.respondWithPage(interaction, newPage, false, filter);
}

// Export with spam protection
export const execute = withSpamProtection(executeCommand);
