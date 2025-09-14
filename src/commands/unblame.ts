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

  const isAdmin = typeof member.permissions === 'string' ? false : member.permissions.has(PermissionFlagsBits.Administrator);

  type Result = 
    | { kind: 'deleted'; id: number; insult: string; userId: string; blamerId: string; note: string | null; createdAt: Date }
    | { kind: 'not_found'; id: number }
    | { kind: 'forbidden'; id: number; reason: 'self_not_blamer' | 'not_owner' };

  const results: Result[] = [];

  for (const id of ids) {
    const found = await prisma.insult.findUnique({ where: { id } });
    if (!found) {
      // Check if it's already archived
      const archived = await prisma.archive.findUnique({ where: { originalInsultId: id } });
      if (archived) {
        results.push({ kind: 'not_found', id }); // Treat as not found since it's already processed
        continue;
      }
      results.push({ kind: 'not_found', id });
      continue;
    }

      // Permission logic:
      // - Anyone can unblame others
      // - You cannot unblame yourself if you are the target but NOT the blamer
      // - Admin can always delete anything
      
      if (found.userId === invokerId && found.blamerId !== invokerId) {
        // Invoker is the target but NOT the blamer - they cannot unblame themselves
        if (!isAdmin) {
          results.push({ kind: 'forbidden', id, reason: 'self_not_blamer' });
          continue;
        }
      }

    // Move to Archive first, then delete
    try {
    await prisma.$transaction([
      (prisma as any).archive.create({
        data: {
          originalInsultId: found.id, // Store the original insult ID
          guildId: found.guildId,
          userId: found.userId,
          blamerId: found.blamerId,
          insult: found.insult,
          note: found.note ?? null,
          createdAt: new Date(found.createdAt),
          unblamerId: invokerId,
        }
      }),
      prisma.insult.delete({ where: { id } }),
    ]);
    results.push({ kind: 'deleted', id, insult: found.insult, userId: found.userId, blamerId: found.blamerId, note: found.note ?? null, createdAt: new Date(found.createdAt) });
    
    // Create embed for this specific unblame action
    const unblameEmbed = new EmbedBuilder()
      .setTitle(`Deleted Blame #${id}`)
      .addFields(
        { name: '**Blame ID**', value: `#${id}`, inline: true },
        { name: '**Insult**', value: found.insult, inline: true },
        { name: '**Note**', value: found.note ?? '—', inline: false },
        { name: '**Insulter**', value: userMention(found.userId), inline: false },
        { name: '**Blamer**', value: userMention(found.blamerId), inline: true },
        { name: '**Unblamer**', value: userMention(interaction.user.id), inline: true },
        { name: '**When**', value: '\u200E' + getShortTime(new Date(found.createdAt)), inline: false },
      )
      .setColor(0xE67E22)
      .setTimestamp(new Date(found.createdAt));

    // Log the gameplay action
    await logGameplayAction(interaction, {
      action: 'unblame',
      target: { id: found.userId } as any, // We'll need to fetch the user if needed
      blamer: { id: found.blamerId } as any,
      unblamer: interaction.user,
      blameId: id,
      embed: unblameEmbed
    });
    } catch (error: any) {
      // Handle unique constraint violation (already archived)
      if (error.code === 'P2002' && error.meta?.target?.includes('originalInsultId')) {
        // The insult was already archived, just delete it
        try {
          await prisma.insult.delete({ where: { id } });
          results.push({ kind: 'deleted', id, insult: found.insult, userId: found.userId, blamerId: found.blamerId, note: found.note ?? null, createdAt: new Date(found.createdAt) });
          
          // Create embed for this specific unblame action
          const unblameEmbed = new EmbedBuilder()
            .setTitle(`Deleted Blame #${id}`)
            .addFields(
              { name: '**Blame ID**', value: `#${id}`, inline: true },
              { name: '**Insult**', value: found.insult, inline: true },
              { name: '**Note**', value: found.note ?? '—', inline: false },
              { name: '**Insulter**', value: userMention(found.userId), inline: false },
              { name: '**Blamer**', value: userMention(found.blamerId), inline: true },
              { name: '**Unblamer**', value: userMention(interaction.user.id), inline: true },
              { name: '**When**', value: '\u200E' + getShortTime(new Date(found.createdAt)), inline: false },
            )
            .setColor(0xE67E22)
            .setTimestamp(new Date(found.createdAt));

          // Log the gameplay action
          await logGameplayAction(interaction, {
            action: 'unblame',
            target: { id: found.userId } as any,
            blamer: { id: found.blamerId } as any,
            unblamer: interaction.user,
            blameId: id,
            embed: unblameEmbed
          });
        } catch (deleteError) {
          console.error(`Failed to delete already archived insult ${id}:`, deleteError);
          results.push({ kind: 'not_found', id }); // Treat as not found since it's already processed
        }
      } else {
        // Other database errors
        console.error(`Failed to unblame insult ${id}:`, error);
        results.push({ kind: 'not_found', id }); // Treat as not found to avoid crashing
      }
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
    const otherIds = forbidden.filter(f => f.reason === 'not_owner').map(f => `#${f.id}`).join(', ');
    if (selfIds) otherParts.push(`Self but not blamer: ${selfIds}`);
    if (otherIds) otherParts.push(`Not your blames: ${otherIds}`);
  }

  // Check if all unblame attempts were denied
  if (deleted.length === 0) {
    // Collect unique reasons for denial
    const reasons: string[] = [];
    if (notFound.length > 0) {
      reasons.push(`**Not Found** (${notFound.length}): ${notFound.map(n => `#${n.id}`).join(', ')}`);
    }
    if (forbidden.length > 0) {
      const selfNotBlamer = forbidden.filter(f => f.reason === 'self_not_blamer');
      const notOwner = forbidden.filter(f => f.reason === 'not_owner');
      
      if (selfNotBlamer.length > 0) {
        reasons.push(`**Cannot unblame yourself** (${selfNotBlamer.length}): ${selfNotBlamer.map(f => `#${f.id}`).join(', ')}`);
      }
      if (notOwner.length > 0) {
        reasons.push(`**Not your blames** (${notOwner.length}): ${notOwner.map(f => `#${f.id}`).join(', ')}`);
      }
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

    const success = await safeInteractionReply(interaction, { 
      embeds: [deniedEmbed]
    });
    if (!success) return;
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
        { name: '**When**', value: '\u200E' + getShortTime(new Date(d.createdAt)), inline: false },
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
      new ButtonBuilder().setCustomId('unblame:next').setLabel('▶').setStyle(ButtonStyle.Secondary).setDisabled(page === pages.length),
      new ButtonBuilder().setCustomId('unblame:last').setLabel('⏭').setStyle(ButtonStyle.Secondary).setDisabled(page === pages.length),
    );
    return [row];
  };

  const initialPage = 1;
  await interaction.reply({ embeds: pages[initialPage - 1].embeds });
  const sent = await interaction.fetchReply();
  sessionStore.set(sent.id, { pages, currentPage: initialPage });
  await interaction.editReply({ components: buildButtons(initialPage, pages.length) });

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