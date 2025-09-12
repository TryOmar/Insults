import { ChatInputCommandInteraction, SlashCommandBuilder, MessageFlags, PermissionFlagsBits, EmbedBuilder, userMention, ActionRowBuilder, ButtonBuilder, ButtonStyle, ButtonInteraction } from 'discord.js';
import { prisma } from '../database/client.js';
import { renderTable, TableConfig } from '../utils/tableRenderer.js';
import { getShortTime } from '../utils/time.js';

export const data = new SlashCommandBuilder()
  .setName('unblame')
  .setDescription('Delete a blame record by ID (you must be the blamer or admin)')
  .addStringOption(opt =>
    opt.setName('id').setDescription('Blame ID').setRequired(true)
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  const raw = interaction.options.getString('id', true);
  const invokerId = interaction.user.id;

  // Extract all numeric IDs from input (split by any non-digit separators)
  const ids = (raw.match(/\d+/g) || []).map(v => parseInt(v, 10)).filter(v => Number.isFinite(v));
  if (ids.length === 0) {
    await interaction.reply({ content: 'Please provide a valid blame ID.', flags: MessageFlags.Ephemeral });
    return;
  }

  const member = await interaction.guild?.members.fetch(invokerId).catch(() => null);
  const isAdmin = member?.permissions.has(PermissionFlagsBits.Administrator) ?? false;

  type Result = 
    | { kind: 'deleted'; id: number; insult: string; userId: string; blamerId: string; note: string | null; createdAt: Date }
    | { kind: 'not_found'; id: number }
    | { kind: 'forbidden'; id: number; reason: 'self_not_blamer' | 'not_owner' };

  const results: Result[] = [];

  for (const id of ids) {
    const found = await prisma.insult.findUnique({ where: { id } });
    if (!found) {
      results.push({ kind: 'not_found', id });
      continue;
    }
    if (found.blamerId !== invokerId && !isAdmin) {
      const reason = found.userId === invokerId ? 'self_not_blamer' : 'not_owner';
      results.push({ kind: 'forbidden', id, reason });
      continue;
    }
    await prisma.insult.delete({ where: { id } });
    results.push({ kind: 'deleted', id, insult: found.insult, userId: found.userId, blamerId: found.blamerId, note: found.note ?? null, createdAt: new Date(found.createdAt) });
  }

  // Build a single public report
  const deleted = results.filter(r => r.kind === 'deleted') as Extract<Result, { kind: 'deleted' }> [];
  const notFound = results.filter(r => r.kind === 'not_found') as Extract<Result, { kind: 'not_found' }> [];
  const forbidden = results.filter(r => r.kind === 'forbidden') as Extract<Result, { kind: 'forbidden' }> [];

  // First page: summary of IDs
  const successIds = deleted.map(d => `#${d.id}`).join(', ') || '—';
  const otherParts: string[] = [];
  if (notFound.length) otherParts.push(`Not found: ${notFound.map(n => `#${n.id}`).join(', ')}`);
  if (forbidden.length) {
    const selfIds = forbidden.filter(f => f.reason === 'self_not_blamer').map(f => `#${f.id}`).join(', ');
    const otherIds = forbidden.filter(f => f.reason === 'not_owner').map(f => `#${f.id}`).join(', ');
    if (selfIds) otherParts.push(`Self but not blamer: ${selfIds}`);
    if (otherIds) otherParts.push(`Not your blames: ${otherIds}`);
  }
  // Build paginated pages: page 1 is summary, remaining are deleted detail embeds
  type Page = { embeds: EmbedBuilder[] };
  const pages: Page[] = [];
  const summaryEmbed = new EmbedBuilder()
    .setTitle('Unblame Summary')
    .addFields(
      { name: 'Deleted', value: successIds, inline: false },
      ...(otherParts.length ? [{ name: 'Other', value: otherParts.join('\n'), inline: false }] : []) as any
    )
    .setColor(0x2ECC71)
    .setTimestamp();
  pages.push({ embeds: [summaryEmbed] });

  for (const d of deleted) {
    const embed = new EmbedBuilder()
      .setTitle(`Deleted Blame #${d.id}`)
      .addFields(
        { name: 'ID', value: String(d.id), inline: true },
        { name: 'Insult', value: d.insult, inline: true },
        { name: 'Note', value: d.note ?? '—', inline: false },
        { name: 'Insulter', value: userMention(d.userId), inline: true },
        { name: 'Blamer', value: userMention(d.blamerId), inline: true },
        { name: 'When', value: '\u200E' + getShortTime(new Date(d.createdAt)), inline: false },
      )
      .setColor(0xE67E22)
      .setTimestamp(new Date(d.createdAt));
    pages.push({ embeds: [embed] });
  }

  const buildButtons = (page: number, total: number) => {
    const row = new ActionRowBuilder<ButtonBuilder>();
    row.addComponents(
      new ButtonBuilder().setCustomId('unblame:first').setLabel('⏮').setStyle(ButtonStyle.Secondary).setDisabled(page === 1),
      new ButtonBuilder().setCustomId('unblame:prev').setLabel('◀').setStyle(ButtonStyle.Secondary).setDisabled(page === 1),
      new ButtonBuilder().setCustomId('unblame:next').setLabel('▶').setStyle(ButtonStyle.Secondary).setDisabled(page === total),
      new ButtonBuilder().setCustomId('unblame:last').setLabel('⏭').setStyle(ButtonStyle.Secondary).setDisabled(page === total),
    );
    return [row];
  };

  const totalPages = Math.max(1, pages.length);
  const initialPage = 1;
  // Reply once without components to get message ID, then attach buttons
  await interaction.reply({ embeds: pages[initialPage - 1].embeds });
  const sent = await interaction.fetchReply();
  sessionStore.set(sent.id, { pages, currentPage: initialPage });
  await interaction.editReply({ components: buildButtons(initialPage, totalPages) });
}

// In-memory session store mapping messageId -> pages and current page index
const sessionStore = new Map<string, { pages: { embeds: EmbedBuilder[] }[]; currentPage: number }>();

export async function handleButton(customId: string, interaction: ButtonInteraction) {
  if (!customId.startsWith('unblame:')) return;
  const action = customId.split(':')[1];
  const messageId = interaction.message?.id;
  if (!messageId) return;
  const session = sessionStore.get(messageId);
  if (!session) return;

  const totalPages = session.pages.length;
  let newPage = session.currentPage;
  if (action === 'first') newPage = 1;
  else if (action === 'prev') newPage = Math.max(1, session.currentPage - 1);
  else if (action === 'next') newPage = Math.min(totalPages, session.currentPage + 1);
  else if (action === 'last') newPage = totalPages;

  session.currentPage = newPage;
  await interaction.update({ embeds: session.pages[newPage - 1].embeds, components: ((page: number, total: number) => {
    const row = new ActionRowBuilder<ButtonBuilder>();
    row.addComponents(
      new ButtonBuilder().setCustomId('unblame:first').setLabel('⏮').setStyle(ButtonStyle.Secondary).setDisabled(page === 1),
      new ButtonBuilder().setCustomId('unblame:prev').setLabel('◀').setStyle(ButtonStyle.Secondary).setDisabled(page === 1),
      new ButtonBuilder().setCustomId('unblame:next').setLabel('▶').setStyle(ButtonStyle.Secondary).setDisabled(page === total),
      new ButtonBuilder().setCustomId('unblame:last').setLabel('⏭').setStyle(ButtonStyle.Secondary).setDisabled(page === total),
    );
    return [row];
  })(newPage, totalPages) });
}


