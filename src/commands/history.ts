import { ActionRowBuilder, ButtonBuilder, ButtonInteraction, ButtonStyle, ChatInputCommandInteraction, EmbedBuilder, SlashCommandBuilder, MessageFlags } from 'discord.js';
import { prisma } from '../database/client.js';
import { renderTable } from '../utils/tableRenderer.js';
import { getShortTime } from '../utils/time.js';

type HistoryScope = { guildId: string; userId?: string | null };

const PAGE_SIZE = 10;

function buildCustomId(scope: HistoryScope, page: number): string {
  return `history:${scope.userId ?? 'all'}:${page}`;
}

function parseCustomId(customId: string): { userId: string | null; page: number } | null {
  const m = customId.match(/^history:([^:]+):([0-9]+)$/);
  if (!m) return null;
  const raw = m[1];
  const userId = raw === 'all' ? null : raw;
  const page = parseInt(m[2], 10) || 1;
  return { userId, page };
}

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
  await respondWithHistory(interaction, scope, 1, true);
}

async function fetchPage(scope: HistoryScope, page: number) {
  const where = { guildId: scope.guildId, ...(scope.userId ? { userId: scope.userId } : {}) } as any;

  const [totalCount, distinctUsers, distinctInsults, entries, targetUser] = await Promise.all([
    prisma.insult.count({ where }),
    prisma.insult.groupBy({ by: ['userId'], where }).then((g) => g.length),
    prisma.insult.groupBy({ by: ['insult'], where, _count: { insult: true } }),
    prisma.insult.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    scope.userId ? prisma.user.findUnique({ where: { id: scope.userId }, select: { username: true } }) : Promise.resolve(null),
  ]);

  // Fetch blamer usernames
  const uniqueBlamerIds = Array.from(new Set(entries.map((e) => e.blamerId)));
  const blamers = uniqueBlamerIds.length
    ? await prisma.user.findMany({ where: { id: { in: uniqueBlamerIds } }, select: { id: true, username: true } })
    : [];
  const blamerMap = new Map(blamers.map((u) => [u.id, u.username]));

  // Build distinct insults summary with counts, sorted by count desc then insult asc
  const insultGroups = distinctInsults
    .sort((a, b) => (b._count.insult - a._count.insult) || a.insult.localeCompare(b.insult))
    .map((g) => `${g.insult}(${g._count.insult})`);

  return { totalCount, distinctUsers, entries, blamerMap, insultGroups, targetUsername: targetUser?.username ?? null };
}

function buildEmbed(scope: HistoryScope, page: number, totalCount: number, distinctUsers: number, distinctInsults: string[], entries: any[], blamerMap: Map<string, string>, serverName: string | undefined, targetUsername: string | null) {
  const headers = ['ID', 'Insult', 'Note', 'Blamer', 'When'];
  const rows = entries.map((e) => [
    String(e.id),
    e.insult,
    e.note ?? '—',
    e.blamerId ? `${blamerMap.get(e.blamerId) ?? 'Unknown'}` : '—',
    getShortTime(new Date(e.createdAt)),
  ]);
  const table = renderTable(headers, rows);

  const title = scope.userId
    ? `📜 History for ${targetUsername ? `${targetUsername}` : scope.userId}`
    : '📜 Server-wide History';
  let distinctInsultsLine = distinctInsults.length ? distinctInsults.join(', ') : '—';
  if (distinctInsultsLine.length > 800) {
    distinctInsultsLine = distinctInsultsLine.slice(0, 800) + ' …';
  }
  const embed = new EmbedBuilder()
    .setTitle(title)
    .setDescription(table)
    .setTimestamp();

  const fields: { name: string; value: string; inline?: boolean }[] = [];
  if (scope.userId) {
    fields.push({ name: 'User', value: `<@${scope.userId}> (${targetUsername ?? scope.userId})`, inline: true });
  }
  fields.push(
    { name: 'Server', value: serverName ?? 'Unknown', inline: true },
    { name: 'Total Blames', value: String(totalCount), inline: true },
  );
  if (!scope.userId) {
    fields.push({ name: 'Total Users', value: String(distinctUsers), inline: true });
  }
  fields.push({ name: 'Total Insults', value: String(distinctInsults.length), inline: true });
  fields.push({ name: 'Insults', value: distinctInsultsLine, inline: false });
  embed.addFields(fields);
  return embed;
}

function buildComponents(scope: HistoryScope, page: number, totalCount: number) {
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const prev = new ButtonBuilder()
    .setCustomId(buildCustomId(scope, Math.max(1, page - 1)))
    .setEmoji('◀️')
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(page <= 1);
  const next = new ButtonBuilder()
    .setCustomId(buildCustomId(scope, Math.min(totalPages, page + 1)))
    .setEmoji('▶️')
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(page >= totalPages);
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(prev, next);
  return [row];
}

export async function respondWithHistory(interaction: ChatInputCommandInteraction | ButtonInteraction, scope: HistoryScope, page: number, isInitial = false) {
  const { totalCount, distinctUsers, entries, blamerMap, insultGroups, targetUsername } = await fetchPage(scope, page);
  const embed = buildEmbed(scope, page, totalCount, distinctUsers, insultGroups, entries, blamerMap, interaction.guild?.name, targetUsername);
  const components = buildComponents(scope, page, totalCount);

  if (isInitial) {
    await interaction.reply({ embeds: [embed], components, flags: MessageFlags.Ephemeral });
  } else {
    if ('update' in interaction) {
      await interaction.update({ embeds: [embed], components });
    } else if ('editReply' in interaction) {
      await interaction.editReply({ embeds: [embed], components });
    }
  }
}

export async function handleButton(customId: string, interaction: ButtonInteraction) {
  const parsed = parseCustomId(customId);
  if (!parsed) return;
  const scope: HistoryScope = { guildId: interaction.guildId as string, userId: parsed.userId };
  await respondWithHistory(interaction, scope, parsed.page, false);
}


