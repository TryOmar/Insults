import { ChatInputCommandInteraction, SlashCommandBuilder, MessageFlags, PermissionFlagsBits, EmbedBuilder, userMention, ActionRowBuilder, ButtonBuilder, ButtonStyle, ButtonInteraction } from 'discord.js';
import { prisma } from '../database/client.js';
import { getShortTime } from '../utils/time.js';
import { safeInteractionReply, getGuildMember } from '../utils/interactionValidation.js';
import { withSpamProtection } from '../utils/commandWrapper.js';
import { canUseBotCommands } from '../utils/roleValidation.js';
import { logGameplayAction } from '../utils/channelLogging.js';
import { updateInsulterRoleAfterCommand } from '../utils/insulterRoleUpdate.js';

export const data = new SlashCommandBuilder()
  .setName('unblame')
  .setDescription('Delete a blame record by ID')
  .addStringOption(opt =>
    opt.setName('id').setDescription('Blame ID').setRequired(true)
  );

type Page = { embeds: EmbedBuilder[] };
const sessionStore = new Map<string, { pages: Page[]; currentPage: number }>();

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

  // Check role permissions
  const member = await getGuildMember(interaction);
  if (!member) {
    const success = await safeInteractionReply(interaction, { 
      content: 'Unable to verify your permissions.', 
      flags: MessageFlags.Ephemeral 
    });
    if (!success) return;
    return;
  }

  const roleCheck = await canUseBotCommands(member, true); // true = mutating command
  if (!roleCheck.allowed) {
    const success = await safeInteractionReply(interaction, { 
      content: roleCheck.reason || 'You do not have permission to use this command.', 
      flags: MessageFlags.Ephemeral 
    });
    if (!success) return;
    return;
  }

  const raw = interaction.options.getString('id', true);
  const invokerId = interaction.user.id;

  // Extract all numeric IDs from input (split by any non-digit separators)
  const rawIds = (raw.match(/\d+/g) || []).map(v => parseInt(v, 10)).filter(v => Number.isFinite(v));
  if (rawIds.length === 0) {
    const success = await safeInteractionReply(interaction, { 
      content: 'Please provide a valid blame ID.', 
      flags: MessageFlags.Ephemeral 
    });
    if (!success) return;
    return;
  }

  // Remove duplicate IDs to prevent unique constraint violations
  const ids = [...new Set(rawIds)];

  const isAdmin = member.permissions?.has(PermissionFlagsBits.Administrator) === true;

  type Result = 
    | { kind: 'deleted'; id: number; insult: string; userId: string; blamerId: string; note: string | null; createdAt: Date }
    | { kind: 'not_found'; id: number }
    | { kind: 'forbidden'; id: number; reason: 'self_not_blamer' };

  const results: Result[] = [];

  // Cap how many IDs we process to prevent overload
  const MAX_IDS = 50;
  const processedIds = ids.slice(0, MAX_IDS);
  const skippedIds = ids.slice(MAX_IDS);

  // Defer reply to avoid interaction timeout for heavier operations
  await interaction.deferReply();

  // Batch-fetch insults scoped to current guild to prevent cross-server unblames
  const foundInsults = await prisma.insult.findMany({ where: { id: { in: processedIds }, guildId } });
  const insultById = new Map<number, typeof foundInsults[number]>(foundInsults.map(i => [i.id, i]));

  // Determine permissions and categorize
  const allowedToDelete: typeof foundInsults = [];
  for (const id of processedIds) {
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
    // Archive all allowed insults, skip duplicates if some were already archived
    const archiveData = allowedToDelete.map(found => ({
      originalInsultId: found.id,
      guildId: found.guildId,
      userId: found.userId,
      blamerId: found.blamerId,
      insult: found.insult,
      note: found.note ?? null,
      createdAt: new Date(found.createdAt),
      unblamerId: invokerId,
    }));

    try {
      await prisma.$transaction([
        (prisma as any).archive.createMany({ data: archiveData, skipDuplicates: true }),
        prisma.insult.deleteMany({ where: { id: { in: allowedToDelete.map(i => i.id) }, guildId } })
      ]);

      // Fill results for deleted items
      for (const found of allowedToDelete) {
        results.push({ kind: 'deleted', id: found.id, insult: found.insult, userId: found.userId, blamerId: found.blamerId, note: found.note ?? null, createdAt: new Date(found.createdAt) });
      }

      // Parallelize gameplay logging
      await Promise.allSettled(allowedToDelete.map(found => {
        const id = found.id;
        const unblameEmbed = new EmbedBuilder()
          .setTitle(`Deleted Blame #${id}`)
          .addFields(
            { name: '**Blame ID**', value: `#${id}`, inline: true },
            { name: '**Insult**', value: found.insult, inline: true },
            { name: '**Note**', value: found.note ?? '—', inline: false },
            { name: '**Insulter**', value: userMention(found.userId), inline: false },
            { name: '**Blamer**', value: userMention(found.blamerId), inline: true },
            { name: '**Unblamer**', value: userMention(interaction.user.id), inline: true },
            { name: '**When blamed**', value: '\u200E' + getShortTime(new Date(found.createdAt)), inline: false },
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
        });
      }));
    } catch (error) {
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

  // Build pages: summary + detail pages for deleted items
  const pages: Page[] = [];
  
  const summary = new EmbedBuilder()
    .setTitle('Unblame Summary')
    .addFields(
      { name: 'Deleted', value: successIds, inline: false },
      ...(otherParts.length ? [{ name: 'Other', value: otherParts.join('\n'), inline: false }] : []) as any
    )
    .setColor(0x2ECC71)
    .setTimestamp();
  pages.push({ embeds: [summary] });

  for (const d of deleted) {
    const embed = new EmbedBuilder()
      .setTitle(`Deleted Blame #${d.id}`)
      .addFields(
        { name: '**Blame ID**', value: `#${d.id}`, inline: true },
        { name: '**Insult**', value: d.insult, inline: true },
        { name: '**Note**', value: d.note ?? '—', inline: false },
        { name: '**Insulter**', value: userMention(d.userId), inline: true },
        { name: '**Blamer**', value: userMention(d.blamerId), inline: true },
        { name: '**Unblamer**', value: userMention(interaction.user.id), inline: true },
        { name: '**When blamed**', value: '\u200E' + getShortTime(new Date(d.createdAt)), inline: false },
      )
      .setColor(0xE67E22)
      .setTimestamp(new Date());
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

  const initialPage = 1;
  await interaction.editReply({ embeds: pages[initialPage - 1].embeds, components: buildButtons(initialPage, pages.length) });
  const sent = await interaction.fetchReply();
  sessionStore.set(sent.id, { pages, currentPage: initialPage });
  // Cleanup session after 15 minutes
  setTimeout(() => sessionStore.delete(sent.id), 15 * 60 * 1000);

  // Update insulter role after successful unblame operations
  if (deleted.length > 0) {
    await updateInsulterRoleAfterCommand(interaction.guild);
  }
}

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
  const row = new ActionRowBuilder<ButtonBuilder>();
  row.addComponents(
    new ButtonBuilder().setCustomId('unblame:first').setLabel('⏮').setStyle(ButtonStyle.Secondary).setDisabled(newPage === 1),
    new ButtonBuilder().setCustomId('unblame:prev').setLabel('◀').setStyle(ButtonStyle.Secondary).setDisabled(newPage === 1),
    new ButtonBuilder().setCustomId('unblame:next').setLabel('▶').setStyle(ButtonStyle.Secondary).setDisabled(newPage === totalPages),
    new ButtonBuilder().setCustomId('unblame:last').setLabel('⏭').setStyle(ButtonStyle.Secondary).setDisabled(newPage === totalPages),
  );
  await interaction.update({ embeds: session.pages[newPage - 1].embeds, components: [row] });
}

// Export with spam protection
export const execute = withSpamProtection(executeCommand);