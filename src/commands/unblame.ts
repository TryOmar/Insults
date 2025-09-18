import { ChatInputCommandInteraction, SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, userMention, ButtonInteraction, ButtonStyle } from 'discord.js';
import { prisma } from '../database/client.js';
import { getShortTime } from '../utils/time.js';
import { safeInteractionReply, getGuildMember } from '../utils/interactionValidation.js';
import { withSpamProtection } from '../utils/commandWrapper.js';
import { canUseBotCommands } from '../utils/roleValidation.js';
import { logGameplayAction } from '../utils/channelLogging.js';
import { updateInsulterRoleAfterCommand } from '../utils/insulterRoleUpdate.js';
import { withGuildAndAuth } from '../utils/commandScaffold.js';
import { parseNumericIds } from '../utils/ids.js';
import { PaginationManager, createStandardCustomId, parseStandardCustomId } from '../utils/pagination.js';
import { buildSummaryEmbed } from '../utils/embeds.js';
import { setupCache } from '../utils/setupCache.js';

export const data = new SlashCommandBuilder()
  .setName('unblame')
  .setDescription('Delete a blame record by ID')
  .addStringOption(opt =>
    opt.setName('id').setDescription('Blame ID').setRequired(true)
  );

// Stateless pager: one item per page, custom button styles, no refresh
const pager = new PaginationManager<any>({
  pageSize: 1,
  commandName: 'unblame',
  customIdPrefix: 'unblame',
  disableRefreshButton: true,
  buttonStyles: {
    first: ButtonStyle.Danger,
    prev: ButtonStyle.Danger,
    next: ButtonStyle.Danger,
    last: ButtonStyle.Danger,
  }
}, {
  fetchData: async (page: number, _pageSize: number, guildId: string, actorId: string, idsCsv: string, notFoundCsv: string, forbiddenCsv: string, skippedCsv: string) => {
    const ids = idsCsv ? idsCsv.split('.').map(x => parseInt(x, 10)).filter(n => !Number.isNaN(n)) : [];
    const [records] = await Promise.all([
      prisma.archive.findMany({
        where: { guildId, id: { in: ids } },
        select: { id: true, guildId: true, userId: true, blamerId: true, insult: true, note: true, createdAt: true, unblamerId: true }
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
      extra: { guildId, actorId, ids, notFoundCsv, forbiddenCsv, skippedCsv }
    } as any;
  },
  buildEmbed: (data: any) => {
    const { items, extra } = data;
    const [d] = items;
    const parseCsv = (s: string | undefined) => (s && s !== '-' ? s.split('.').filter(Boolean) : []);
    const notFound = parseCsv(extra.notFoundCsv);
    const forbidden = parseCsv(extra.forbiddenCsv);
    const skipped = parseCsv(extra.skippedCsv);

    const summaryLines: string[] = [];
    if (extra.ids?.length) summaryLines.push(`🟢 Deleted: ${extra.ids.join(', ')}`);
    if (notFound.length) summaryLines.push(`🔴 Not found: ${notFound.join(', ')}`);
    if (forbidden.length) summaryLines.push(`⚠️ Forbidden: ${forbidden.join(', ')}`);
    if (skipped.length) summaryLines.push(`↩️ Skipped: ${skipped.join(', ')}`);

    const embed = new EmbedBuilder()
      .setTitle(d ? `Deleted Blame ${d.id}` : 'Deleted Blame')
      .setColor(0xE67E22)
      .setTimestamp(new Date());

    if (d) {
      embed.addFields(
        { name: '**Insult**', value: d.insult, inline: true },
        { name: '**Unblamer**', value: userMention(d.unblamerId ?? extra.actorId), inline: true },
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
  buildCustomId: (page: number, guildId: string, actorId: string, idsCsv: string, notFoundCsv: string, forbiddenCsv: string, skippedCsv: string) => {
    return createStandardCustomId('unblame', page, guildId, actorId, idsCsv || '-', notFoundCsv || '-', forbiddenCsv || '-', skippedCsv || '-');
  },
  parseCustomId: (sessionId: string) => {
    const parsed = parseStandardCustomId(sessionId, 'unblame');
    if (!parsed) return null;
    const [guildId, actorId, idsCsv, notFoundCsv, forbiddenCsv, skippedCsv] = parsed.params;
    return { page: parsed.page, guildId, actorId, idsCsv, notFoundCsv, forbiddenCsv, skippedCsv } as any;
  }
});

async function executeCommand(interaction: ChatInputCommandInteraction) {
  const ctx = await withGuildAndAuth(interaction, { requiresMutating: true, defer: true });
  if (!ctx) return;

  const { guildId, invokerId, member } = ctx;

  // Get setup data for logging
  const setup = await setupCache.getSetup(guildId);

  const raw = interaction.options.getString('id', true);
  const { processed: ids, skipped: skippedIds } = parseNumericIds(raw, 50);

  const isAdmin = member.permissions?.has(PermissionFlagsBits.Administrator) === true;

  type Result = 
    | { kind: 'deleted'; id: number; insult: string; userId: string; blamerId: string; note: string | null; createdAt: Date }
    | { kind: 'not_found'; id: number }
    | { kind: 'forbidden'; id: number; reason: 'self_not_blamer' };

  const results: Result[] = [];

  // Early validation - check if any IDs are valid before processing
  if (ids.length === 0) {
    const errorEmbed = new EmbedBuilder()
      .setTitle('❌ Invalid Input')
      .setDescription('Please provide a valid blame ID.')
      .setColor(0xE74C3C)
      .setTimestamp();
    await interaction.editReply({ embeds: [errorEmbed] });
    return;
  }

  // Batch-fetch insults scoped to current guild to prevent cross-server unblames
  const foundInsults = await prisma.insult.findMany({ 
    where: { guildId, id: { in: ids } },
    select: {
      id: true,
      guildId: true,
      userId: true,
      blamerId: true,
      insult: true,
      note: true,
      createdAt: true
    }
  });
  const insultById = new Map<number, typeof foundInsults[number]>(foundInsults.map(i => [i.id, i]));

  // Determine permissions and categorize
  const allowedToDelete: typeof foundInsults = [];
  for (const id of ids) {
    const found = insultById.get(id);
    if (!found) {
      // If it's already archived or not present at all, treat as not found
      results.push({ kind: 'not_found', id });
      continue;
    }

    // Permission logic:
    // - Anyone can unblame others
    // - You cannot unblame yourself if you are the target but NOT the blamer
    // - Admin can always delete anything
    if (found.userId === invokerId && found.blamerId !== invokerId && !isAdmin) {
      results.push({ kind: 'forbidden', id, reason: 'self_not_blamer' });
      continue;
    }

    allowedToDelete.push(found);
  }

  if (allowedToDelete.length > 0) {
    try {
      // Single optimized transaction - archive and delete in one go
      await prisma.$transaction(async (tx) => {
        // Create archive records with the same ID
        const archiveData = allowedToDelete.map(found => ({
          id: found.id,
          guildId: found.guildId,
          userId: found.userId,
          blamerId: found.blamerId,
          insult: found.insult,
          note: found.note ?? null,
          createdAt: new Date(found.createdAt),
          unblamerId: invokerId,
        }));

        await tx.archive.createMany({ data: archiveData, skipDuplicates: true });
        await tx.insult.deleteMany({ where: { guildId, id: { in: allowedToDelete.map(i => i.id) } } });
      });

      // Fill results for deleted items
      for (const found of allowedToDelete) {
        results.push({ 
          kind: 'deleted', 
          id: found.id, 
          insult: found.insult, 
          userId: found.userId, 
          blamerId: found.blamerId, 
          note: found.note ?? null, 
          createdAt: new Date(found.createdAt) 
        });
      }

      // Parallelize gameplay logging (non-blocking)
      setImmediate(() => {
        Promise.allSettled(allowedToDelete.map(found => {
          const id = found.id;
          const unblameEmbed = new EmbedBuilder()
            .setTitle(`Deleted Blame ${id}`)
            .addFields(
              { name: '**Insult**', value: found.insult, inline: true },
              { name: '**Unblamer**', value: userMention(interaction.user.id), inline: true },
              { name: '**Note**', value: found.note ?? '—', inline: false },
              { name: '**Insulter**', value: userMention(found.userId), inline: true },
              { name: '**Blamer**', value: userMention(found.blamerId), inline: true },
              { name: '**When blamed**', value: `<t:${Math.floor(new Date(found.createdAt).getTime() / 1000)}:R>`, inline: false },
            )
            .setColor(0xE67E22)
            .setTimestamp(new Date());

        return logGameplayAction(interaction, {
          action: 'unblame',
          target: { id: found.userId } as any,
          blamer: { id: found.blamerId } as any,
          unblamer: interaction.user,
          blameId: id,
          embed: unblameEmbed
        }, setup);
        }));
      });
    } catch (error) {
      console.error('Unblame transaction failed:', error);
      const errorEmbed = new EmbedBuilder()
        .setTitle('❌ Unblame Failed')
        .setDescription('An error occurred while deleting blames. Please try again later.')
        .setColor(0xE74C3C)
        .setTimestamp();
      await interaction.editReply({ embeds: [errorEmbed] });
      return;
    }
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
    if (selfIds) otherParts.push(`Cannot unblame yourself unless you were the blamer: ${selfIds}`);
  }
  if (skippedIds.length) otherParts.push(`Skipped (too many IDs): ${skippedIds.map(id => `#${id}`).join(', ')}`);

  // Check if all unblame attempts were denied
  if (deleted.length === 0) {
    // Collect unique reasons for denial
    const reasons: string[] = [];
    if (notFound.length > 0) {
      reasons.push(`**Not Found** (${notFound.length}): ${notFound.map(n => `#${n.id}`).join(', ')}`);
    }
    if (forbidden.length > 0) {
      const selfNotBlamer = forbidden.filter(f => f.reason === 'self_not_blamer');
      if (selfNotBlamer.length > 0) {
        reasons.push(`**Cannot unblame yourself** (${selfNotBlamer.length}): ${selfNotBlamer.map(f => `#${f.id}`).join(', ')}`);
      }
    }
    if (skippedIds.length > 0) {
      reasons.push(`**Skipped** (${skippedIds.length}): ${skippedIds.map(id => `#${id}`).join(', ')}`);
    }

    // Send a single professional response with all denial reasons
    const deniedEmbed = new EmbedBuilder()
      .setTitle('❌ Unblame Denied')
      .setDescription('None of the requested blame records could be deleted.')
      .addFields(
        { name: '**Reasons**', value: reasons.join('\n\n'), inline: false }
      )
      .setColor(0xE74C3C)
      .setTimestamp();
    await interaction.editReply({ embeds: [deniedEmbed] });
    return;
  }

  // Build summary text for all pages
  const summaryLines: string[] = [];
  if (deleted.length > 0) {
    summaryLines.push(`🟢 Deleted: ${deleted.map(d => d.id).join(', ')}`);
  }
  if (notFound.length > 0) {
    summaryLines.push(`🔴 Not found: ${notFound.map(n => n.id).join(', ')}`);
  }
  if (forbidden.length > 0) {
    summaryLines.push(`⚠️ Forbidden: ${forbidden.map(f => f.id).join(', ')}`);
  }
  if (skippedIds.length > 0) {
    summaryLines.push(`↩️ Skipped: ${skippedIds.join(', ')}`);
  }

  // Stateless pager send: encode session in customId
  const idsCsv = deleted.map(d => d.id).join('.');
  const notFoundCsv = notFound.map(n => n.id).join('.');
  const forbiddenCsv = forbidden.map(f => f.id).join('.');
  const skippedCsv = skippedIds.join('.');

  await pager.handleInitialCommand(interaction as any, guildId, interaction.user.id, idsCsv, notFoundCsv, forbiddenCsv, skippedCsv);

  // Update insulter role after successful unblame operations
  if (deleted.length > 0) {
    await updateInsulterRoleAfterCommand(interaction.guild);
  }
}

export async function handleButton(customId: string, interaction: ButtonInteraction) {
  if (!customId.startsWith('unblame:')) return;

  const parts = customId.split(':');
  if (parts.length < 3) return;

  const action = parts[1];
  const sessionId = parts.slice(2).join(':');
  const parsed = parseStandardCustomId(sessionId, 'unblame');
  if (!parsed) return;

  const [guildId, actorId, idsCsvRaw, notFoundCsv = '-', forbiddenCsv = '-', skippedCsv = '-'] = parsed.params;
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

  await pager.respondWithPage(interaction as any, newPage, false, guildId, actorId, idsCsv, notFoundCsv, forbiddenCsv, skippedCsv);
}

// Export with spam protection
export const execute = withSpamProtection(executeCommand);