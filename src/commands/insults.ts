import { ActionRowBuilder, ButtonBuilder, ButtonInteraction, ButtonStyle, ChatInputCommandInteraction, EmbedBuilder, MessageFlags, SlashCommandBuilder, userMention } from 'discord.js';
import { prisma } from '../database/client.js';
import { getShortTime } from '../utils/time.js';
import { renderTable, TableConfig } from '../utils/tableRenderer.js';

const PAGE_SIZE = 10;

type ViewScope =
  | { mode: 'all'; guildId: string }
  | { mode: 'word'; guildId: string; word: string };

function buildCustomId(scope: ViewScope, page: number): string {
  if (scope.mode === 'all') return `insults:all:${page}`;
  // store word safely using base64url to support non-ascii
  const encoded = Buffer.from(scope.word, 'utf8').toString('base64url');
  return `insults:word:${encoded}:${page}`;
}

function parseCustomId(customId: string): { scope: ViewScope; page: number } | null {
  const mAll = customId.match(/^insults:all:([0-9]+)$/);
  if (mAll) {
    const page = parseInt(mAll[1], 10) || 1;
    return { scope: { mode: 'all', guildId: '' }, page } as any;
  }
  const mWord = customId.match(/^insults:word:([A-Za-z0-9_-]+):([0-9]+)$/);
  if (mWord) {
    const word = Buffer.from(mWord[1], 'base64url').toString('utf8');
    const page = parseInt(mWord[2], 10) || 1;
    return { scope: { mode: 'word', guildId: '', word }, page } as any;
  }
  return null;
}

// Local generic table renderer with dynamic column sizing

export const data = new SlashCommandBuilder()
  .setName('insults')
  .setDescription('Show insult stats overall or for a specific word')
  .addStringOption(opt =>
    opt.setName('word')
      .setDescription('Optional: specific insult token (letters and numbers allowed; no spaces or symbols)')
      .setRequired(false)
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  const guildId = interaction.guildId;
  if (!guildId) {
    await interaction.reply({ content: 'This command can only be used in a server.', flags: MessageFlags.Ephemeral });
    return;
  }

  const wordRaw = interaction.options.getString('word', false);
  if (wordRaw && !/^[\p{L}\p{Nd}]+$/u.test(wordRaw)) {
    await interaction.reply({ content: 'Word must be a single token with only letters and numbers. No spaces or symbols.', flags: MessageFlags.Ephemeral });
    return;
  }

  // If no word provided, show a leaderboard-style preview
  if (!wordRaw) {
    await showInsultsPreview(interaction, guildId);
    return;
  }

  const scope: ViewScope = { mode: 'word', guildId, word: wordRaw };
  await respondWithInsults(interaction, scope, 1, true);
}

async function showInsultsPreview(interaction: ChatInputCommandInteraction, guildId: string) {
  // Get top insults by count with top blamer info
  const topInsults = await prisma.insult.groupBy({
    by: ['insult'],
    where: { guildId },
    _count: { insult: true },
    orderBy: [{ _count: { insult: 'desc' } }, { insult: 'asc' }],
    take: 10,
  });

  if (topInsults.length === 0) {
    await interaction.reply({ content: 'No insults recorded yet.', flags: MessageFlags.Ephemeral });
    return;
  }

  const LRM = '\u200E'; // Left-to-Right Mark
  const insultList = topInsults.map((item, index) => {
    const rank = index + 1;
    let rankText = '';
    if (rank === 1) {
      rankText = '**1st:** 🔥';
    } else if (rank === 2) {
      rankText = '**2nd:** ⚡';
    } else if (rank === 3) {
      rankText = '**3rd:** 💥';
    } else {
      rankText = `**${rank}.**`;
    }
    
    const line = `${rankText} ${item.insult} - ${item._count.insult}`;
    return LRM + line; // Add LRM at the start of each line
  }).join('\n');

  const embed = new EmbedBuilder()
    .setTitle('🔥 Top Insults')
    .setDescription(insultList)
    .setColor(0xFF6B6B) // Light red color
    .setFooter({ text: 'Use /insults <word> for details' })
    .setTimestamp();

  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

async function fetchGeneralPage(guildId: string, page: number) {
  const [totalRecorded, groupedAll] = await Promise.all([
    prisma.insult.count({ where: { guildId } }),
    prisma.insult.groupBy({
      by: ['insult'],
      where: { guildId },
      _count: { insult: true },
      orderBy: [{ _count: { insult: 'desc' } }, { insult: 'asc' }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
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

  return { totalRecorded, distinctInsultsTotal, items: details.map(d => ({
    insult: d.insult,
    count: d.count,
    first: d.firstBlamerId ? `@${username.get(d.firstBlamerId) ?? d.firstBlamerId}` : '—',
    last: d.lastBlamerId ? `@${username.get(d.lastBlamerId) ?? d.lastBlamerId}` : '—',
    top: d.topBlamerId ? `@${username.get(d.topBlamerId) ?? d.topBlamerId}` : '—',
  })),
    totalDistinctOnPage: groupedAll.length };
}

async function fetchWordPage(guildId: string, word: string, page: number) {
  const where = { guildId, insult: word } as const;
  const [totalCount, distinctUsersCount, topBlamerGroup, entries] = await Promise.all([
    prisma.insult.count({ where }),
    prisma.insult.groupBy({ by: ['userId'], where }).then(g => g.length),
    prisma.insult.groupBy({ by: ['blamerId'], where, _count: { blamerId: true }, orderBy: [{ _count: { blamerId: 'desc' } }, { blamerId: 'asc' }], take: 1 }),
    prisma.insult.findMany({ where, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE }),
  ]);

  const userIds = new Set<string>();
  if (topBlamerGroup[0]?.blamerId) userIds.add(topBlamerGroup[0].blamerId);
  entries.forEach(e => { if (e.userId) userIds.add(e.userId); if (e.blamerId) userIds.add(e.blamerId); });
  const users = userIds.size ? await prisma.user.findMany({ where: { id: { in: Array.from(userIds) } }, select: { id: true, username: true } }) : [];
  const username = new Map(users.map(u => [u.id, u.username]));

  const metadata = {
    total: totalCount,
    users: distinctUsersCount,
    top: topBlamerGroup[0]?.blamerId ? `@${username.get(topBlamerGroup[0].blamerId) ?? topBlamerGroup[0].blamerId}` : '—',
  };

  const rows = entries.map(e => [
    String(e.id),
    `@${username.get(e.userId) ?? e.userId}`,
    `@${username.get(e.blamerId) ?? e.blamerId}`,
    e.note ?? '—',
    getShortTime(new Date(e.createdAt)),
  ]);

  return { metadata, rows, totalCount };
}

function buildComponents(scope: ViewScope, page: number, totalCount: number) {
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  // If only one page, no pagination controls
  if (totalPages <= 1) return [] as any;

  const prevId = buildCustomId(scope, Math.max(1, page - 1));
  const nextId = buildCustomId(scope, Math.min(totalPages, page + 1));

  const prev = new ButtonBuilder().setCustomId(prevId).setEmoji('◀️').setStyle(ButtonStyle.Secondary).setDisabled(page <= 1);
  const next = new ButtonBuilder().setCustomId(nextId).setEmoji('▶️').setStyle(ButtonStyle.Secondary).setDisabled(page >= totalPages);

  const row = new ActionRowBuilder<ButtonBuilder>();
  row.addComponents(prev);
  if (nextId !== prevId) row.addComponents(next);
  return [row];
}

export async function respondWithInsults(interaction: ChatInputCommandInteraction | ButtonInteraction, scope: ViewScope, page: number, isInitial = false) {
  const guildId = (interaction.guildId ?? (scope as any).guildId) as string;
  const word = (scope as any).word;

  // word-specific
  const { metadata, rows, totalCount } = await fetchWordPage(guildId, word, page);
  const headers = ['ID', 'User', 'Blamer', 'Note', 'When'];
  const config: TableConfig = {
    columns: [
      { maxWidth: 4 },   // ID
      { maxWidth: 14 },   // User
      { maxWidth: 10 },   // Blamer
      { maxWidth: 12 },   // Note
      { maxWidth: 6 }     // When
    ],
    emptyMessage: 'No occurrences found for this insult'
  };
  const table = renderTable(headers, rows, config);
  const embed = new EmbedBuilder()
    .setTitle(`💀 Insult: "${word}"`)
    .setDescription(table)
    .addFields(
      { name: 'Total', value: String(metadata.total), inline: true },
      { name: 'Users', value: String(metadata.users), inline: true },
      { name: 'Top Blamer', value: metadata.top, inline: true },
    )
    .setColor(0xDC143C) // Dark red color
    .setTimestamp();
  const components = buildComponents(scope, page, metadata.total);

  if (isInitial) {
    await interaction.reply({ embeds: [embed], components, flags: MessageFlags.Ephemeral });
  } else if ('update' in interaction) {
    await (interaction as ButtonInteraction).update({ embeds: [embed], components });
  } else if ('editReply' in interaction) {
    await (interaction as any).editReply({ embeds: [embed], components });
  }
}

export async function handleButton(customId: string, interaction: ButtonInteraction) {
  const parsed = parseCustomId(customId);
  if (!parsed) return;
  const guildId = interaction.guildId as string;
  const { scope, page } = parsed;
  const effectiveScope: ViewScope = scope.mode === 'all' ? { mode: 'all', guildId } : { mode: 'word', guildId, word: (scope as any).word } as any;
  await respondWithInsults(interaction, effectiveScope, page, false);
}


