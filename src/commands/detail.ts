import { ButtonInteraction, ChatInputCommandInteraction, SlashCommandBuilder, MessageFlags, EmbedBuilder, ButtonStyle } from 'discord.js';
import { prisma } from '../database/client.js';
import { buildBlameEmbedFromRecord } from '../services/blame.js';
import { withSpamProtection } from '../utils/commandWrapper.js';
import { canUseBotCommands } from '../utils/roleValidation.js';
import { getGuildMember } from '../utils/interactionValidation.js';
import { parseNumericIds } from '../utils/ids.js';
import { PaginationManager, createStandardCustomId, parseStandardCustomId } from '../utils/pagination.js';

export const data = new SlashCommandBuilder()
  .setName('detail')
  .setDescription('Show full details for one or more blame records by ID')
  .addStringOption(opt =>
    opt.setName('id').setDescription('One or more IDs (e.g. 12 18 25)').setRequired(true)
  );

const pager = new PaginationManager<any>({
  pageSize: 1,
  commandName: 'detail',
  customIdPrefix: 'detail',
  ephemeral: false,
  buttonStyles: {
    first: ButtonStyle.Secondary,
    prev: ButtonStyle.Secondary,
    next: ButtonStyle.Secondary,
    last: ButtonStyle.Secondary,
    refresh: ButtonStyle.Secondary,
  }
}, {
  fetchData: async (page: number, _pageSize: number, guildId: string, idsCsv: string, guildName: string | undefined, notFoundCsv: string | undefined, skippedCsv: string | undefined) => {
    const ids = idsCsv ? idsCsv.split('.').map(x => parseInt(x, 10)).filter(n => !Number.isNaN(n)) : [];
    const totalPages = Math.max(1, ids.length || 1);
    const index = Math.min(Math.max(1, page), totalPages) - 1;
    const currentId = ids[index];

    let record: any = null;
    let isArchived = false;
    if (currentId) {
      record = await prisma.insult.findFirst({ where: { id: currentId, guildId } });
      if (!record) {
        const archivedRecord = await (prisma as any).archive.findFirst({ where: { id: currentId, guildId } });
        if (archivedRecord) {
          record = {
            id: archivedRecord.id,
            guildId: archivedRecord.guildId,
            userId: archivedRecord.userId,
            blamerId: archivedRecord.blamerId,
            insult: archivedRecord.insult,
            note: archivedRecord.note,
            createdAt: new Date(archivedRecord.createdAt),
          };
          isArchived = true;
        }
      }
    }

    let embed: EmbedBuilder | null = null;
    if (record) {
      embed = await buildBlameEmbedFromRecord('public', record, guildName);
      // Title with ID; preserve archived prefix if set
      const baseTitle = `Blame #${record.id}`;
      const isAlreadyArchived = (embed.data.title || '').startsWith('🗑️ Archived -');
      embed.setTitle(isArchived || isAlreadyArchived ? `🗑️ Archived - ${baseTitle}` : baseTitle);
      // Use a distinctive color for detail pages (amethyst)
      embed.setColor(0xFFFFFF); // White
    }

    return {
      items: embed ? [{ embed }] : [],
      totalCount: ids.length,
      currentPage: index + 1,
      totalPages,
      extra: { guildId, ids, notFoundCsv: notFoundCsv ?? '-', skippedCsv: skippedCsv ?? '-' }
    } as any;
  },
  buildEmbed: (data: any) => {
    const { items, currentPage, totalPages, extra } = data;
    if (!items.length) {
      // Show summary-only embed when nothing to display
      const parseCsvNumeric = (s: string | undefined) => (s && s !== '-' ? s
        .split('.')
        .filter(Boolean)
        .filter(token => /^\d+$/.test(token))
      : []);
      const notFound = parseCsvNumeric(extra?.notFoundCsv);
      const skipped = parseCsvNumeric(extra?.skippedCsv);
      const summaryLines: string[] = [];
      if (notFound.length) summaryLines.push(`🔴 Not found: ${notFound.join(', ')}`);
      if (skipped.length) summaryLines.push(`↩️ Skipped: ${skipped.join(', ')}`);
      return new EmbedBuilder()
        .setTitle('Blame Details')
        .setDescription(summaryLines.join('\n') || 'No valid IDs to display.')
        .setColor(0x9B59B6)
        .setTimestamp();
    }
    const { embed } = items[0] as { embed: EmbedBuilder };
    // Remove server name and record id fields; move Insulter/Blamer next to Note
    const fields = Array.isArray(embed.data.fields) ? [...embed.data.fields] : [];
    const filtered = fields.filter(f => f.name !== '**Server**' && f.name !== '**Blame ID**');
    const takeByName = (name: string) => {
      const idx = filtered.findIndex(f => f.name === name);
      return idx >= 0 ? filtered.splice(idx, 1)[0] : undefined;
    };
    const insultField = takeByName('**Insult**');
    const freqField = takeByName('**Frequency (server-wide)**');
    const noteField = takeByName('**Note**');
    const insulterField = takeByName('**Insulter**');
    const blamerField = takeByName('**Blamer**');
    if (insultField) insultField.inline = true;
    if (freqField) freqField.inline = true;
    if (noteField) noteField.inline = false;
    if (insulterField) insulterField.inline = true;
    if (blamerField) blamerField.inline = true;
    const reordered = [
      ...(insultField ? [insultField] : []),
      ...(freqField ? [freqField] : []),
      ...(noteField ? [noteField] : []),
      ...(insulterField ? [insulterField] : []),
      ...(blamerField ? [blamerField] : []),
      ...filtered,
    ];
    if (reordered.length) embed.setFields(reordered as any);

    // Ensure title reflects current ID
    const currentId = (extra?.ids as number[])[Math.max(0, currentPage - 1)];
    if (currentId) {
      const isArchived = (embed.data.title || '').startsWith('🗑️ Archived -');
      embed.setTitle(isArchived ? `🗑️ Archived - Blame #${currentId}` : `Blame #${currentId}`);
    }
    // Summary lines
    const parseCsvNumeric = (s: string | undefined) => (s && s !== '-' ? s
      .split('.')
      .filter(Boolean)
      .filter(token => /^\d+$/.test(token))
    : []);
    const notFound = parseCsvNumeric(extra?.notFoundCsv);
    const skipped = parseCsvNumeric(extra?.skippedCsv);
    const found = (extra?.ids as number[] | undefined) ?? [];
    const summaryLines: string[] = [];
    if (found.length) summaryLines.push(`🟢 Found: ${found.join(', ')}`);
    if (notFound.length) summaryLines.push(`🔴 Not found: ${notFound.join(', ')}`);
    if (skipped.length) summaryLines.push(`↩️ Skipped: ${skipped.join(', ')}`);
    if (summaryLines.length) {
      embed.addFields({ name: '**Summary**', value: summaryLines.join('\n'), inline: false });
    }
    embed.setFooter({ text: `Page ${currentPage}/${totalPages}` });
    return embed;
  },
  buildCustomId: (page: number, guildId: string, idsCsv: string, notFoundCsv?: string, skippedCsv?: string) => {
    return createStandardCustomId('detail', page, guildId, idsCsv || '-', notFoundCsv || '-', skippedCsv || '-');
  },
  parseCustomId: (sessionId: string) => {
    const parsed = parseStandardCustomId(sessionId, 'detail');
    if (!parsed) return null;
    const [guildId, idsCsv, notFoundCsv, skippedCsv] = parsed.params;
    return { page: parsed.page, guildId, idsCsv, notFoundCsv, skippedCsv } as any;
  }
});

async function executeCommand(interaction: ChatInputCommandInteraction) {
  const raw = interaction.options.getString('id', true);
  const guildId = interaction.guildId;
  const guildName = interaction.guild?.name;

  if (!guildId) {
    await interaction.reply({ content: 'This command can only be used in a server.', flags: MessageFlags.Ephemeral });
    return;
  }

  try {
    await interaction.deferReply();
  } catch {}

  const member = await getGuildMember(interaction);
  if (!member) {
    await interaction.editReply({ content: 'Unable to verify your permissions.' });
    return;
  }
  const roleCheck = await canUseBotCommands(member, false);
  if (!roleCheck.allowed) {
    await interaction.editReply({ content: roleCheck.reason || 'You do not have permission to use this command.' });
    return;
  }

  const { processed: ids, skipped: skippedIds } = parseNumericIds(raw, 50);
  if (ids.length === 0) {
    await interaction.editReply({ content: 'Please provide at least one valid ID.' });
    return;
  }

  // Determine which IDs exist (active or archived)
  const [active, archived] = await Promise.all([
    prisma.insult.findMany({ where: { guildId, id: { in: ids } }, select: { id: true } }),
    (prisma as any).archive.findMany({ where: { guildId, id: { in: ids } }, select: { id: true } })
  ]);
  const existingSet = new Set<number>([...active.map(a => a.id), ...archived.map((a: any) => a.id)]);
  const foundIds = ids.filter(id => existingSet.has(id));
  const notFoundIds = ids.filter(id => !existingSet.has(id));

  const idsCsv = foundIds.join('.');
  const notFoundCsv = notFoundIds.join('.');
  const skippedCsv = skippedIds.join('.');

  await pager.handleInitialCommand(interaction as any, guildId, idsCsv, guildName, notFoundCsv, skippedCsv);

  if (ids.length === 1) {
    try {
  const sent = await interaction.fetchReply();
    if ('react' in sent && typeof sent.react === 'function') {
      await sent.react('👍');
      await sent.react('👎');
    }
    } catch {}
  }
}

export const execute = withSpamProtection(executeCommand);

export async function handleButton(customId: string, interaction: ButtonInteraction) {
  if (!customId.startsWith('detail:')) return;
  const parts = customId.split(':');
  if (parts.length < 3) return;
  const action = parts[1];
  const sessionId = parts.slice(2).join(':');
  const parsed = parseStandardCustomId(sessionId, 'detail');
  if (!parsed) return;
  const [guildId, idsCsvRaw = '-', notFoundCsv = '-', skippedCsv = '-'] = parsed.params;
  const idsCsv = idsCsvRaw === '-' ? '' : idsCsvRaw;
  const ids = idsCsv ? idsCsv.split('.').filter(Boolean) : [];

  let newPage = parsed.page;
  switch (action) {
    case 'first': newPage = 1; break;
    case 'prev': newPage = Math.max(1, parsed.page - 1); break;
    case 'next': newPage = parsed.page + 1; break;
    case 'last': newPage = Math.max(1, ids.length); break;
    case 'refresh': newPage = parsed.page; break;
    default: return;
  }

  // Defer update to avoid interaction expiration before we edit
  try { if (!interaction.deferred && !interaction.replied) await interaction.deferUpdate(); } catch {}
  await pager.respondWithPage(interaction as any, newPage, false, guildId, idsCsv, interaction.guild?.name, notFoundCsv, skippedCsv);
}


