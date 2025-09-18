import { ChatInputCommandInteraction, SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, userMention, ButtonInteraction, ButtonStyle } from 'discord.js';
import { prisma } from '../database/client.js';
import { getShortTime } from '../utils/time.js';
import { withSpamProtection } from '../utils/commandWrapper.js';
import { logGameplayAction } from '../utils/channelLogging.js';
import { updateInsulterRoleAfterCommand } from '../utils/insulterRoleUpdate.js';
import { withGuildAndAuth } from '../utils/commandScaffold.js';
import { parseNumericIds } from '../utils/ids.js';
import { PaginationManager, createStandardCustomId, parseStandardCustomId } from '../utils/pagination.js';
import { buildSummaryEmbed } from '../utils/embeds.js';
import { setupCache } from '../utils/setupCache.js';

export const data = new SlashCommandBuilder()
  .setName('revert')
  .setDescription('Restore archived blames back into active records')
  .addStringOption(opt =>
    opt.setName('id').setDescription('Archived blame ID').setRequired(true)
  );

// Stateless pager: one item per page, custom button styles, no refresh
const pager = new PaginationManager<any>({
  pageSize: 1,
  commandName: 'revert',
  customIdPrefix: 'revert',
  disableRefreshButton: true,
  buttonStyles: {
    first: ButtonStyle.Success,
    prev: ButtonStyle.Success,
    next: ButtonStyle.Success,
    last: ButtonStyle.Success,
  }
}, {
  fetchData: async (page: number, _pageSize: number, guildId: string, actorId: string, idsCsv: string, notFoundCsv: string, forbiddenCsv: string, failedCsv: string, skippedCsv: string) => {
    const ids = idsCsv ? idsCsv.split('.').map(x => parseInt(x, 10)).filter(n => !Number.isNaN(n)) : [];
    const [records] = await Promise.all([
      prisma.insult.findMany({
        where: { guildId, id: { in: ids } },
        select: { id: true, guildId: true, userId: true, blamerId: true, insult: true, note: true, createdAt: true }
      })
    ]);
    const totalPages = Math.max(1, ids.length || 1);
    const index = Math.min(Math.max(1, page), totalPages) - 1;
    const currentId = ids[index];
    const current = records.find(r => r.id === currentId) ?? null;
    return {
      items: current ? [current] : [],
      totalCount: ids.length,
      currentPage: index + 1,
      totalPages,
      extra: { guildId, actorId, ids, notFoundCsv, forbiddenCsv, failedCsv, skippedCsv }
    } as any;
  },
  buildEmbed: (data: any) => {
    const { items, extra } = data;
    const [d] = items;
    const parseCsv = (s: string | undefined) => (s && s !== '-' ? s.split('.').filter(Boolean) : []);
    const notFound = parseCsv(extra.notFoundCsv);
    const forbidden = parseCsv(extra.forbiddenCsv);
    const failed = parseCsv(extra.failedCsv);
    const skipped = parseCsv(extra.skippedCsv);

    const summaryLines: string[] = [];
    if (extra.ids?.length) summaryLines.push(`🟢 Restored: ${extra.ids.join(', ')}`);
    if (notFound.length) summaryLines.push(`🔴 Not found: ${notFound.join(', ')}`);
    if (forbidden.length) summaryLines.push(`⚠️ Forbidden: ${forbidden.join(', ')}`);
    if (failed.length) summaryLines.push(`❌ Failed: ${failed.join(', ')}`);
    if (skipped.length) summaryLines.push(`↩️ Skipped: ${skipped.join(', ')}`);

    const embed = new EmbedBuilder()
      .setTitle(d ? `Restored Blame ${d.id}` : 'Restored Blame')
      .setColor(0xF39C12)
      .setTimestamp(d ? new Date(d.createdAt) : new Date());

    if (d) {
      embed.addFields(
        { name: '**Insult**', value: d.insult, inline: true },
        { name: '**Reverter**', value: userMention(extra.actorId), inline: true },
        { name: '**Note**', value: d.note ?? '—', inline: false },
        { name: '**Insulter**', value: userMention(d.userId), inline: true },
        { name: '**Blamer**', value: userMention(d.blamerId), inline: true },
        { name: '**When blamed**', value: `<t:${Math.floor(new Date(d.createdAt).getTime() / 1000)}:R>`, inline: false },
        { name: '**Summary**', value: summaryLines.join('\n') || 'No operations performed', inline: false }
      );
    } else {
      embed.setDescription('Record not found. It may have been modified since.');
    }
    return embed;
  },
  buildCustomId: (page: number, guildId: string, actorId: string, idsCsv: string, notFoundCsv: string, forbiddenCsv: string, failedCsv: string, skippedCsv: string) => {
    return createStandardCustomId('revert', page, guildId, actorId, idsCsv || '-', notFoundCsv || '-', forbiddenCsv || '-', failedCsv || '-', skippedCsv || '-');
  },
  parseCustomId: (sessionId: string) => {
    const parsed = parseStandardCustomId(sessionId, 'revert');
    if (!parsed) return null;
    const [guildId, actorId, idsCsv, notFoundCsv, forbiddenCsv, failedCsv, skippedCsv] = parsed.params;
    return { page: parsed.page, guildId, actorId, idsCsv, notFoundCsv, forbiddenCsv, failedCsv, skippedCsv } as any;
  }
});

async function executeCommand(interaction: ChatInputCommandInteraction) {
  const ctx = await withGuildAndAuth(interaction, { requiresMutating: true, defer: true });
  if (!ctx) return;

  const { guildId, invokerId, member } = ctx;

  // Get setup data for logging
  const setup = await setupCache.getSetup(guildId);

  const raw = interaction.options.getString('id', true);

  const MAX_IDS = 50;
  const { processed: processedIds, skipped: skippedIds } = parseNumericIds(raw, MAX_IDS);
  if (processedIds.length === 0) {
    // Already deferred; edit the reply with an error and exit
    const errorEmbed = new EmbedBuilder()
      .setTitle('❌ Invalid Input')
      .setDescription('Please provide a valid archived blame ID.')
      .setColor(0xE74C3C)
      .setTimestamp();
    await interaction.editReply({ embeds: [errorEmbed] });
    return;
  }

  const isAdmin = member.permissions?.has(PermissionFlagsBits.Administrator) === true;

  type Result = 
    | { kind: 'restored'; id: number; insult: string; userId: string; blamerId: string; note: string | null; createdAt: Date }
    | { kind: 'not_found'; id: number }
    | { kind: 'forbidden'; id: number }
    | { kind: 'failed'; id: number };

  const results: Result[] = [];
  // Batch-fetch archives for the requested IDs, scoped to current guild
  const archives = await prisma.archive.findMany({ 
    where: { guildId, id: { in: processedIds } },
    select: {
      id: true,
      guildId: true,
      userId: true,
      blamerId: true,
      insult: true,
      note: true,
      createdAt: true,
      unblamerId: true,
      unblamedAt: true
    }
  });

  // Permission filtering
  const allowed = archives.filter((a: any) => a.blamerId === invokerId || isAdmin);
  const allowedById = new Map<number, any>(allowed.map((a: any) => [a.id, a]));

  // Mark not found and forbidden
  for (const id of processedIds) {
    const a = archives.find((x: any) => x.id === id);
    if (!a) {
      results.push({ kind: 'not_found', id });
      continue;
    }
    if (a.blamerId !== invokerId && !isAdmin) {
      results.push({ kind: 'forbidden', id });
    }
  }

  // Early return if no allowed items
  if (allowed.length === 0) {
    const errorEmbed = new EmbedBuilder()
      .setTitle('❌ No Items to Revert')
      .setDescription('No archived blames found that you have permission to restore.')
      .setColor(0xE74C3C)
      .setTimestamp();
    await interaction.editReply({ embeds: [errorEmbed] });
    return;
  }

  // Create insults for allowed in parallel, using the same ID
  let creations: PromiseSettledResult<any>[] = [];
  try {
    creations = await Promise.allSettled(allowed.map((a: any) => prisma.insult.create({
      data: {
        id: a.id,
        guildId: a.guildId,
        userId: a.userId,
        blamerId: a.blamerId,
        insult: a.insult,
        note: a.note ?? null,
        createdAt: new Date(a.createdAt),
      }
    })));
  } catch (err) {
    console.error('Revert creation failed:', err);
    const errorEmbed = new EmbedBuilder()
      .setTitle('❌ Revert Failed')
      .setDescription('An error occurred while restoring blames. Please try again later.')
      .setColor(0xE74C3C)
      .setTimestamp();
    await interaction.editReply({ embeds: [errorEmbed] });
    return;
  }

  // Map created results by id
  const createdById = new Map<number, any>();
  const failedCreations: number[] = [];
  creations.forEach((res, idx) => {
    const id = allowed[idx].id;
    if (res.status === 'fulfilled') {
      createdById.set(id, res.value);
    } else {
      failedCreations.push(id);
      results.push({ kind: 'failed', id });
    }
  });

  // Bulk delete archives for successfully created ones in a single transaction
  const idsToDelete = allowed.map((a: any) => a.id).filter((id: number) => createdById.has(id));
  if (idsToDelete.length > 0) {
    try {
      await prisma.archive.deleteMany({ where: { guildId, id: { in: idsToDelete } } });
    } catch (err) {
      console.error('Archive cleanup failed:', err);
      const errorEmbed = new EmbedBuilder()
        .setTitle('⚠️ Partial Revert')
        .setDescription('Some blames were restored but archives could not be cleaned up.')
        .setColor(0xE67E22)
        .setTimestamp();
      await interaction.editReply({ embeds: [errorEmbed] });
      return;
    }
  }

  // Collect results and log in parallel
  const restoredForLogging: { restored: any; archive: any }[] = [];
  for (const id of idsToDelete) {
    const archive = allowedById.get(id);
    const restoredInsult = createdById.get(id);
    if (!archive || !restoredInsult) continue;
    results.push({
      kind: 'restored',
      id: id, // Use the same ID as the archive
      insult: archive.insult,
      userId: archive.userId,
      blamerId: archive.blamerId,
      note: archive.note ?? null,
      createdAt: new Date(archive.createdAt)
    });
    restoredForLogging.push({ restored: restoredInsult, archive });
  }

  // Parallelize gameplay logging (non-blocking)
  setImmediate(() => {
    Promise.allSettled(restoredForLogging.map(({ restored, archive }) => {
      const revertEmbed = new EmbedBuilder()
        .setTitle(`Restored Blame #${restored.id}`)
        .addFields(
          //{ name: '**Blame ID**', value: `#${restored.id}`, inline: true },
          { name: '**Insult**', value: archive.insult, inline: true },
          { name: '**Reverter**', value: userMention(interaction.user.id), inline: true },
          { name: '**Note**', value: archive.note ?? '—', inline: false },
          { name: '**Insulter**', value: userMention(archive.userId), inline: true },
          { name: '**Blamer**', value: userMention(archive.blamerId), inline: true },
          { name: '**When blamed**', value: `<t:${Math.floor(new Date(archive.createdAt).getTime() / 1000)}:R>`, inline: false },
        )
        .setColor(0xF39C12)
        .setTimestamp(new Date());

      return logGameplayAction(interaction, {
        action: 'revert',
        target: { id: archive.userId } as any,
        blamer: { id: archive.blamerId } as any,
        unblamer: interaction.user,
        blameId: restored.id,
        embed: revertEmbed
      }, setup);
    }));
  });

  const restored = results.filter(r => r.kind === 'restored') as Extract<Result, { kind: 'restored' }> [];
  const notFound = results.filter(r => r.kind === 'not_found') as Extract<Result, { kind: 'not_found' }> [];
  const forbidden = results.filter(r => r.kind === 'forbidden') as Extract<Result, { kind: 'forbidden' }> [];
  const failed = results.filter(r => r.kind === 'failed') as Extract<Result, { kind: 'failed' }> [];

  // Build summary text for all pages
  const summaryLines: string[] = [];
  if (restored.length > 0) {
    const restoredText = restoredForLogging.map(({ restored }) => String(restored.id)).join(', ');
    summaryLines.push(`🟢 Restored: ${restoredText}`);
  }
  if (notFound.length > 0) {
    summaryLines.push(`🔴 Not found: ${notFound.map(n => n.id).join(', ')}`);
  }
  if (forbidden.length > 0) {
    summaryLines.push(`⚠️ Forbidden: ${forbidden.map(f => f.id).join(', ')}`);
  }
  if (failed.length > 0) {
    summaryLines.push(`❌ Failed: ${failed.map(f => f.id).join(', ')}`);
  }
  if (skippedIds.length > 0) {
    summaryLines.push(`↩️ Skipped: ${skippedIds.join(', ')}`);
  }

  // Stateless pager send: encode session in customId
  const idsCsv = restored.map(d => d.id).join('.');
  const notFoundCsv = notFound.map(n => n.id).join('.');
  const forbiddenCsv = forbidden.map(f => f.id).join('.');
  const failedCsv = failed.map(f => f.id).join('.');
  const skippedCsv = skippedIds.join('.');

  await pager.handleInitialCommand(interaction as any, guildId, interaction.user.id, idsCsv, notFoundCsv, forbiddenCsv, failedCsv, skippedCsv);

  // Update insulter role after successful revert operations
  if (restored.length > 0) {
    await updateInsulterRoleAfterCommand(interaction.guild);
  }
}

export async function handleButton(customId: string, interaction: ButtonInteraction) {
  if (!customId.startsWith('revert:')) return;

  const parts = customId.split(':');
  if (parts.length < 3) return;

  const action = parts[1];
  const sessionId = parts.slice(2).join(':');
  const parsed = parseStandardCustomId(sessionId, 'revert');
  if (!parsed) return;

  const [guildId, actorId, idsCsvRaw, notFoundCsv = '-', forbiddenCsv = '-', failedCsv = '-', skippedCsv = '-'] = parsed.params;
  const idsCsv = idsCsvRaw === '-' ? '' : idsCsvRaw;

  const ids = idsCsv ? idsCsv.split('.').filter(Boolean) : [];

  let newPage = parsed.page;
  switch (action) {
    case 'first':
      newPage = 1;
      break;
    case 'prev':
      newPage = Math.max(1, parsed.page - 1);
      break;
    case 'next':
      newPage = parsed.page + 1;
      break;
    case 'last':
      newPage = Math.max(1, ids.length);
      break;
    case 'refresh':
      newPage = parsed.page;
      break;
    default:
      return;
  }

  await pager.respondWithPage(interaction as any, newPage, false, guildId, actorId, idsCsv, notFoundCsv, forbiddenCsv, failedCsv, skippedCsv);
}

// Export with spam protection
export const execute = withSpamProtection(executeCommand);
