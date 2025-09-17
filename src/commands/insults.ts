import { ActionRowBuilder, ButtonBuilder, ButtonInteraction, ButtonStyle, ChatInputCommandInteraction, EmbedBuilder, MessageFlags, SlashCommandBuilder, userMention } from 'discord.js';
import { prisma } from '../database/client.js';
import { withRetry } from '../database/retry.js';
import { getShortTime } from '../utils/time.js';
import { renderTable, TableConfig } from '../utils/tableRenderer.js';
import { PaginationManager, createStandardCustomId, parseStandardCustomId, PaginationData } from '../utils/pagination.js';
import { safeInteractionReply, getGuildMember } from '../utils/interactionValidation.js';
import { withSpamProtection } from '../utils/commandWrapper.js';
import { validateInsultInput } from '../utils/insultUtils.js';
import { canUseBotCommands } from '../utils/roleValidation.js';

const PAGE_SIZE = 10;

type ViewScope =
  | { mode: 'all'; guildId: string }
  | { mode: 'word'; guildId: string; word: string };

// Local generic table renderer with dynamic column sizing

export const data = new SlashCommandBuilder()
  .setName('insults')
  .setDescription('Show insult stats overall or for a specific word')
  .addStringOption(opt =>
    opt.setName('word')
      .setDescription('Optional: specific insult to search for')
      .setRequired(false)
      .setMaxLength(100)
  );

async function executeCommand(interaction: ChatInputCommandInteraction) {
  const guildId = interaction.guildId;
  if (!guildId) {
    const success = await safeInteractionReply(interaction, { 
      content: 'This command can only be used in a server.', 
      flags: MessageFlags.Ephemeral 
    });
    if (!success) return;
    return;
  }

  // Defer the interaction to show "thinking" state
  try {
    await interaction.deferReply();
  } catch (error) {
    // Ignore if already acknowledged
    console.warn('Failed to defer insults interaction:', error);
  }

  // Check role permissions
  const member = await getGuildMember(interaction);
  if (!member) {
    await interaction.editReply({ content: 'Unable to verify your permissions.' });
    return;
  }

  const roleCheck = await canUseBotCommands(member, false); // false = non-mutating command
  if (!roleCheck.allowed) {
    await interaction.editReply({ 
      content: roleCheck.reason || 'You do not have permission to use this command.'
    });
    return;
  }

  const wordRaw = interaction.options.getString('word', false);
  if (wordRaw) {
    try {
      const cleaned = validateInsultInput(wordRaw);
      if (!cleaned) {
        const success = await safeInteractionReply(interaction, { 
          content: 'Please enter a valid insult.', 
          flags: MessageFlags.Ephemeral 
        });
        if (!success) return;
        return;
      }
      // Store cleaned word for exact DB match
      (interaction as any)._cleanedWord = cleaned;
    } catch (error) {
      const success = await safeInteractionReply(interaction, { 
        content: (error as Error).message, 
        flags: MessageFlags.Ephemeral 
      });
      if (!success) return;
      return;
    }
  }

  const scope: ViewScope = wordRaw 
    ? { mode: 'word', guildId, word: ((interaction as any)._cleanedWord ?? wordRaw) as string }
    : { mode: 'all', guildId };
  
  const paginationManager = createInsultsPaginationManager();
  await paginationManager.handleInitialCommand(interaction, scope);
}

// Export with spam protection
export const execute = withSpamProtection(executeCommand);


async function fetchGeneralPage(guildId: string, page: number, pageSize: number): Promise<PaginationData<any>> {
  return withRetry(async () => {
    // Use a single transaction to batch all queries
    return await prisma.$transaction(async (tx) => {
      // Get the grouped insults with pagination in one query
      const groupedAll = await tx.insult.groupBy({
        by: ['insult'],
        where: { guildId },
        _count: { insult: true },
        orderBy: [{ _count: { insult: 'desc' } }, { insult: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      });

      // Get total counts in parallel within the same transaction
      const [totalRecorded, distinctInsultsTotal] = await Promise.all([
        tx.insult.count({ where: { guildId } }),
        tx.insult.groupBy({ by: ['insult'], where: { guildId } }).then(g => g.length)
      ]);

      // Simple items - just insult and count (no user lookups needed)
      const items = groupedAll.map(g => ({
        insult: g.insult,
        count: g._count.insult
      }));

      const totalPages = Math.max(1, Math.ceil(distinctInsultsTotal / pageSize));

      return {
        items,
        totalCount: distinctInsultsTotal,
        currentPage: page,
        totalPages,
        totalRecorded,
        totalDistinctOnPage: groupedAll.length
      } as any;
    });
  }, 'fetchGeneralPage');
}

async function fetchInsultsData(scope: ViewScope, page: number, pageSize: number): Promise<PaginationData<any>> {
  if (scope.mode === 'word') {
    return await fetchWordPage(scope.guildId, scope.word, page, pageSize);
  } else {
    return await fetchGeneralPage(scope.guildId, page, pageSize);
  }
}

async function fetchWordPage(guildId: string, word: string, page: number, pageSize: number): Promise<PaginationData<any>> {
  return withRetry(async () => {
    const where = { guildId, insult: word } as const;
    
    // Use a single transaction to batch all queries
    return await prisma.$transaction(async (tx) => {
      // Get all data in parallel within the same transaction
      const [totalCount, distinctUsersCount, entries] = await Promise.all([
        tx.insult.count({ where }),
        tx.insult.groupBy({ by: ['userId'], where }).then(g => g.length),
        tx.insult.findMany({ 
          where, 
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], 
          skip: (page - 1) * pageSize, 
          take: pageSize,
          select: { id: true, userId: true, createdAt: true } // Only select needed fields
        }),
      ]);

      // Simple metadata without user lookups
      const metadata = {
        total: totalCount,
        users: distinctUsersCount,
        top: '—', // Simplified - no user lookup
      };

      // Simple rows without username lookup
      const rows = entries.map(e => [
        String(e.id),
        e.userId, // Just show user ID instead of username
        '\u200E' + getShortTime(new Date(e.createdAt)),
      ]);

      const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

      return {
        items: rows,
        totalCount,
        currentPage: page,
        totalPages,
        metadata,
        word
      } as PaginationData<any> & {
        metadata: any;
        word: string;
      };
    });
  }, 'fetchWordPage');
}

function buildInsultsEmbed(data: PaginationData<any> & {
  metadata: any;
  word: string;
}, scope: ViewScope): EmbedBuilder {
  const { items, totalCount, currentPage, totalPages, metadata, word } = data;
  
  if (scope.mode === 'word') {
    const headers = ['ID', 'Insulter', 'When'];
    const config: TableConfig = {
      columns: [
        { maxWidth: 4 },   // ID
        { maxWidth: 12 },  // Insulter
        { maxWidth: 8 }    // When
      ],
      emptyMessage: 'No occurrences found for this insult'
    };
    const table = renderTable(headers, items, config);
    return new EmbedBuilder()
      .setTitle(`💀 Insult: "${word}"`)
      .setDescription(table)
      .addFields(
        { name: 'Total', value: String(metadata.total), inline: true },
        { name: 'Users', value: String(metadata.users), inline: true },
        { name: 'Top Insulter', value: metadata.top, inline: true },
        { name: '', value: '*Use `/detail <id>` for more info*', inline: false },
      )
      .setFooter({ text: `Page ${currentPage}/${totalPages}` })
      .setColor(0xDC143C) // Dark red color
      .setTimestamp();
  } else {
    // General view - show insults in table format
    const headers = ['Insult', 'Frequency'];
    const rows = items.map((item: any) => [
      item.insult,
      String(item.count)
    ]);

    const config: TableConfig = {
      columns: [
        { maxWidth: 25 },  // Insult
        { maxWidth: 16 }    // Frequency
      ],
      emptyMessage: 'No insults recorded yet'
    };

    const table = renderTable(headers, rows, config);
    return new EmbedBuilder()
      .setTitle('💀 Insults Overview')
      .setDescription(table)
      .setFooter({ text: `Page ${currentPage}/${totalPages}` })
      .setColor(0xDC143C)
      .setTimestamp();
  }
}

function createInsultsPaginationManager(): PaginationManager<any, PaginationData<any> & {
  metadata: any;
  word: string;
}> {
  return new PaginationManager(
    {
      pageSize: PAGE_SIZE,
      commandName: 'insults',
      customIdPrefix: 'insults',
      ephemeral: false // Make responses public
    },
    {
      fetchData: async (page: number, pageSize: number, scope: ViewScope) => {
        return await fetchInsultsData(scope, page, pageSize) as PaginationData<any> & {
          metadata: any;
          word: string;
        };
      },
      buildEmbed: (data: PaginationData<any> & {
        metadata: any;
        word: string;
      }, scope: ViewScope) => {
        return buildInsultsEmbed(data, scope);
      },
      buildCustomId: (page: number, scope: ViewScope) => {
        if (scope.mode === 'all') {
          return createStandardCustomId('insults', page, 'all');
        } else {
          const encoded = Buffer.from(scope.word, 'utf8').toString('base64url');
          return createStandardCustomId('insults', page, 'word', encoded);
        }
      },
      parseCustomId: (customId: string) => {
        const parsed = parseStandardCustomId(customId, 'insults');
        if (!parsed) return null;
        
        if (parsed.params[0] === 'all') {
          return { page: parsed.page, mode: 'all' };
        } else if (parsed.params[0] === 'word' && parsed.params[1]) {
          const word = Buffer.from(parsed.params[1], 'base64url').toString('utf8');
          return { page: parsed.page, mode: 'word', word };
        }
        return null;
      }
    }
  );
}

export async function handleButton(customId: string, interaction: ButtonInteraction) {
  if (!customId.startsWith('insults:')) return;
  
  // Extract the session ID from the custom ID
  const parts = customId.split(':');
  if (parts.length < 3) return;
  
  const sessionId = parts.slice(2).join(':'); // Rejoin in case there are colons in the session ID
  const parsed = parseStandardCustomId(sessionId, 'insults');
  if (!parsed) return;
  
  const guildId = interaction.guildId as string;
  let scope: ViewScope;
  
  if (parsed.params[0] === 'all') {
    scope = { mode: 'all', guildId };
  } else if (parsed.params[0] === 'word' && parsed.params[1]) {
    const word = Buffer.from(parsed.params[1], 'base64url').toString('utf8');
    scope = { mode: 'word', guildId, word };
  } else {
    return;
  }
  
  const paginationManager = createInsultsPaginationManager();
  
  // Handle the button click manually to ensure correct arguments are passed
  const [prefix, action, ...sessionParts] = customId.split(':');
  const fullSessionId = sessionParts.join(':');
  const sessionParsed = parseStandardCustomId(fullSessionId, 'insults');
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
      const totalCount = await withRetry(async () => {
        if (scope.mode === 'word') {
          return await prisma.insult.count({ where: { guildId: scope.guildId, insult: scope.word } });
        } else {
          return await prisma.insult.groupBy({ by: ['insult'], where: { guildId: scope.guildId } }).then(g => g.length);
        }
      }, 'getTotalCount');
      newPage = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
      break;
    case 'refresh':
      newPage = sessionParsed.page; // Stay on current page but refresh data
      break;
    default:
      return;
  }
  
  await paginationManager.respondWithPage(interaction, newPage, false, scope);
}



