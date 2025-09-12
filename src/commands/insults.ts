import { ActionRowBuilder, ButtonBuilder, ButtonInteraction, ButtonStyle, ChatInputCommandInteraction, EmbedBuilder, MessageFlags, SlashCommandBuilder, userMention } from 'discord.js';
import { prisma } from '../database/client.js';
import { getShortTime } from '../utils/time.js';
import { renderTable, TableConfig } from '../utils/tableRenderer.js';
import { PaginationManager, createStandardCustomId, parseStandardCustomId, PaginationData } from '../utils/pagination.js';
import { safeInteractionReply } from '../utils/interactionValidation.js';

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
      .setDescription('Optional: specific insult phrase (up to 3 words)')
      .setRequired(false)
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  const guildId = interaction.guildId;
  if (!guildId) {
    const success = await safeInteractionReply(interaction, { 
      content: 'This command can only be used in a server.', 
      flags: MessageFlags.Ephemeral 
    });
    if (!success) return;
    return;
  }

  const wordRaw = interaction.options.getString('word', false);
  if (wordRaw) {
    const normalized = wordRaw
      .toLowerCase()
      .split(/[^\p{L}\p{Nd}]+/u)
      .filter(Boolean)
      .join(' ');
    const wc = normalized.split(/\s+/).filter(Boolean).length;
    if (wc === 0) {
      const success = await safeInteractionReply(interaction, { 
        content: 'Please enter an insult phrase.', 
        flags: MessageFlags.Ephemeral 
      });
      if (!success) return;
      return;
    }
    if (wc > 3) {
      const success = await safeInteractionReply(interaction, { 
        content: 'Insult phrase must be up to 3 words.', 
        flags: MessageFlags.Ephemeral 
      });
      if (!success) return;
      return;
    }
    // Overwrite the raw input with normalized for exact DB match
    (interaction as any)._normalizedWord = normalized;
  }

  const scope: ViewScope = wordRaw 
    ? { mode: 'word', guildId, word: ((interaction as any)._normalizedWord ?? wordRaw) as string }
    : { mode: 'all', guildId };
  
  const paginationManager = createInsultsPaginationManager();
  await paginationManager.handleInitialCommand(interaction, scope);
}


async function fetchGeneralPage(guildId: string, page: number, pageSize: number): Promise<PaginationData<any>> {
  const [totalRecorded, groupedAll] = await Promise.all([
    prisma.insult.count({ where: { guildId } }),
    prisma.insult.groupBy({
      by: ['insult'],
      where: { guildId },
      _count: { insult: true },
      orderBy: [{ _count: { insult: 'desc' } }, { insult: 'asc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  const distinctInsultsTotal = await prisma.insult.groupBy({ by: ['insult'], where: { guildId } }).then(g => g.length);

  // For each insult in page, compute first, last, and top blamer
  const details = await Promise.all(groupedAll.map(async (g) => {
    const insult = g.insult;
    const [firstRow, lastRow, topBlamer] = await Promise.all([
      prisma.insult.findFirst({ where: { guildId, insult }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: { blamerId: true } }),
      prisma.insult.findFirst({ where: { guildId, insult }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: { blamerId: true } }),
      prisma.insult.groupBy({ by: ['blamerId'], where: { guildId, insult }, _count: { blamerId: true }, orderBy: [{ _count: { blamerId: 'desc' } }, { blamerId: 'asc' }], take: 1 }),
    ]);
    return { insult, count: g._count.insult, firstBlamerId: firstRow?.blamerId ?? null, lastBlamerId: lastRow?.blamerId ?? null, topBlamerId: topBlamer[0]?.blamerId ?? null };
  }));

  const userIds = Array.from(new Set(details.flatMap(d => [d.firstBlamerId, d.lastBlamerId, d.topBlamerId]).filter(Boolean) as string[]));
  const users = userIds.length ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, username: true } }) : [];
  const username = new Map(users.map(u => [u.id, u.username]));

  const items = details.map(d => ({
    insult: d.insult,
    count: d.count,
    first: d.firstBlamerId ? `${username.get(d.firstBlamerId) ?? d.firstBlamerId}` : '—',
    last: d.lastBlamerId ? `${username.get(d.lastBlamerId) ?? d.lastBlamerId}` : '—',
    top: d.topBlamerId ? `${username.get(d.topBlamerId) ?? d.topBlamerId}` : '—',
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
}

async function fetchInsultsData(scope: ViewScope, page: number, pageSize: number): Promise<PaginationData<any>> {
  if (scope.mode === 'word') {
    return await fetchWordPage(scope.guildId, scope.word, page, pageSize);
  } else {
    return await fetchGeneralPage(scope.guildId, page, pageSize);
  }
}

async function fetchWordPage(guildId: string, word: string, page: number, pageSize: number): Promise<PaginationData<any>> {
  const where = { guildId, insult: word } as const;
  const [totalCount, distinctUsersCount, topInsulterGroup, entries] = await Promise.all([
    prisma.insult.count({ where }),
    prisma.insult.groupBy({ by: ['userId'], where }).then(g => g.length),
    prisma.insult.groupBy({ by: ['userId'], where, _count: { userId: true }, orderBy: [{ _count: { userId: 'desc' } }, { userId: 'asc' }], take: 1 }),
    prisma.insult.findMany({ where, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], skip: (page - 1) * pageSize, take: pageSize }),
  ]);

  const userIds = new Set<string>();
  if (topInsulterGroup[0]?.userId) userIds.add(topInsulterGroup[0].userId);
  entries.forEach(e => { if (e.userId) userIds.add(e.userId); if (e.blamerId) userIds.add(e.blamerId); });
  const users = userIds.size ? await prisma.user.findMany({ where: { id: { in: Array.from(userIds) } }, select: { id: true, username: true } }) : [];
  const username = new Map(users.map(u => [u.id, u.username]));

  const metadata = {
    total: totalCount,
    users: distinctUsersCount,
    top: topInsulterGroup[0]?.userId ? `${username.get(topInsulterGroup[0].userId) ?? topInsulterGroup[0].userId}` : '—',
  };

  const rows = entries.map(e => [
    String(e.id),
    `${username.get(e.userId) ?? e.userId}`,
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
        { maxWidth: 8 }    // Frequency
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
      // Get current data to determine total pages
      const currentData = await fetchInsultsData(scope, sessionParsed.page, PAGE_SIZE);
      newPage = Math.min(currentData.totalPages, sessionParsed.page + 1);
      break;
    case 'last':
      // Get current data to determine total pages
      const lastData = await fetchInsultsData(scope, sessionParsed.page, PAGE_SIZE);
      newPage = lastData.totalPages;
      break;
    case 'refresh':
      newPage = sessionParsed.page; // Stay on current page but refresh data
      break;
    default:
      return;
  }
  
  await paginationManager.respondWithPage(interaction, newPage, false, scope);
}


