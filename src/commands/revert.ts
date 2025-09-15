import { ChatInputCommandInteraction, SlashCommandBuilder, MessageFlags, PermissionFlagsBits, EmbedBuilder, userMention, ActionRowBuilder, ButtonBuilder, ButtonStyle, ButtonInteraction } from 'discord.js';
import { prisma } from '../database/client.js';
import { getShortTime } from '../utils/time.js';
import { withSpamProtection } from '../utils/commandWrapper.js';
import { canUseBotCommands } from '../utils/roleValidation.js';
import { logGameplayAction } from '../utils/channelLogging.js';
import { updateInsulterRoleAfterCommand } from '../utils/insulterRoleUpdate.js';
import { getGuildMember } from '../utils/interactionValidation.js';

export const data = new SlashCommandBuilder()
  .setName('revert')
  .setDescription('Restore archived blames back into active records')
  .addStringOption(opt =>
    opt.setName('id').setDescription('Archived blame ID').setRequired(true)
  );

type Page = { embeds: EmbedBuilder[] };
const sessionStore = new Map<string, { pages: Page[]; currentPage: number }>();

async function executeCommand(interaction: ChatInputCommandInteraction) {
  const guildId = interaction.guildId;
  if (!guildId) {
    await interaction.reply({ content: 'This command can only be used in a server.', flags: MessageFlags.Ephemeral });
    return;
  }

  // Check role permissions
  const member = await getGuildMember(interaction);
  if (!member) {
    await interaction.reply({ content: 'Unable to verify your permissions.', flags: MessageFlags.Ephemeral });
    return;
  }

  const roleCheck = await canUseBotCommands(member, true); // true = mutating command
  if (!roleCheck.allowed) {
    await interaction.reply({ content: roleCheck.reason || 'You do not have permission to use this command.', flags: MessageFlags.Ephemeral });
    return;
  }

  const raw = interaction.options.getString('id', true);
  const invokerId = interaction.user.id;

  const ids = (raw.match(/\d+/g) || []).map(v => parseInt(v, 10)).filter(v => Number.isFinite(v));
  if (ids.length === 0) {
    await interaction.reply({ content: 'Please provide a valid archived blame ID.', flags: MessageFlags.Ephemeral });
    return;
  }

  const MAX_IDS = 50;
  const processedIds = [...new Set(ids)].slice(0, MAX_IDS);
  const skippedIds = [...new Set(ids)].slice(MAX_IDS);

  // Avoid interaction timeout while doing DB work
  await interaction.deferReply();

  const isAdmin = member.permissions?.has(PermissionFlagsBits.Administrator) === true;

  type Result = 
    | { kind: 'restored'; id: number; originalId: number; insult: string; userId: string; blamerId: string; note: string | null; createdAt: Date }
    | { kind: 'not_found'; id: number }
    | { kind: 'forbidden'; id: number }
    | { kind: 'failed'; id: number };

  const results: Result[] = [];
  // Batch-fetch archives for the requested original IDs, scoped to current guild
  const archives = await (prisma as any).archive.findMany({ where: { originalInsultId: { in: processedIds }, guildId } });

  // Permission filtering
  const allowed = archives.filter((a: any) => a.blamerId === invokerId || isAdmin);
  const allowedByOriginalId = new Map<number, any>(allowed.map((a: any) => [a.originalInsultId, a]));

  // Mark not found and forbidden
  for (const id of processedIds) {
    const a = archives.find((x: any) => x.originalInsultId === id);
    if (!a) {
      results.push({ kind: 'not_found', id });
      continue;
    }
    if (a.blamerId !== invokerId && !isAdmin) {
      results.push({ kind: 'forbidden', id });
    }
  }

  // Create insults for allowed in parallel to obtain new IDs
  let creations: PromiseSettledResult<any>[] = [];
  try {
    creations = await Promise.allSettled(allowed.map((a: any) => prisma.insult.create({
      data: {
        guildId: a.guildId,
        userId: a.userId,
        blamerId: a.blamerId,
        insult: a.insult,
        note: a.note ?? null,
        createdAt: new Date(a.createdAt),
      }
    })));
  } catch (err) {
    const errorEmbed = new EmbedBuilder()
      .setTitle('❌ Revert Failed')
      .setDescription('An error occurred while restoring blames. Please try again later.')
      .setColor(0xE74C3C)
      .setTimestamp();
    await interaction.editReply({ embeds: [errorEmbed] });
    return;
  }

  // Map created results by original id
  const createdByOriginal = new Map<number, any>();
  creations.forEach((res, idx) => {
    const origId = allowed[idx].originalInsultId;
    if (res.status === 'fulfilled') {
      createdByOriginal.set(origId, res.value);
    }
  });

  // Bulk delete archives for successfully created ones
  const originalsToDelete = allowed.map((a: any) => a.originalInsultId).filter((oid: number) => createdByOriginal.has(oid));
  if (originalsToDelete.length > 0) {
    try {
      await (prisma as any).archive.deleteMany({ where: { originalInsultId: { in: originalsToDelete }, guildId } });
    } catch (err) {
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
  for (const oid of originalsToDelete) {
    const archive = allowedByOriginalId.get(oid);
    const restoredInsult = createdByOriginal.get(oid);
    if (!archive || !restoredInsult) continue;
    results.push({
      kind: 'restored',
      id: restoredInsult.id,
      originalId: oid,
      insult: archive.insult,
      userId: archive.userId,
      blamerId: archive.blamerId,
      note: archive.note ?? null,
      createdAt: new Date(archive.createdAt)
    });
    restoredForLogging.push({ restored: restoredInsult, archive });
  }

  await Promise.allSettled(restoredForLogging.map(({ restored, archive }) => {
    const revertEmbed = new EmbedBuilder()
      .setTitle(`Restored Blame #${restored.id}`)
      .addFields(
        { name: '**New Blame ID**', value: `#${restored.id}`, inline: true },
        { name: '**Original ID**', value: `#${archive.originalInsultId}`, inline: true },
        { name: '**Insult**', value: archive.insult, inline: true },
        { name: '**Note**', value: archive.note ?? '—', inline: false },
        { name: '**Insulter**', value: userMention(archive.userId), inline: true },
        { name: '**Blamer**', value: userMention(archive.blamerId), inline: true },
        { name: '**When (original)**', value: '\u200E' + getShortTime(new Date(archive.createdAt)), inline: false },
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
    });
  }));

  const restored = results.filter(r => r.kind === 'restored') as Extract<Result, { kind: 'restored' }> [];
  const notFound = results.filter(r => r.kind === 'not_found') as Extract<Result, { kind: 'not_found' }> [];
  const forbidden = results.filter(r => r.kind === 'forbidden') as Extract<Result, { kind: 'forbidden' }> [];
  const failed = results.filter(r => r.kind === 'failed') as Extract<Result, { kind: 'failed' }> [];

  // Build pages: summary + detail pages for restored
  const pages: Page[] = [];
  const successIds = restored.map(d => `Original #${d.originalId} → Restored #${d.id}`).join('\n') || '—';
  const otherParts: string[] = [];
  if (notFound.length) otherParts.push(`Not found: ${notFound.map(n => `#${n.id}`).join(', ')}`);
  if (forbidden.length) otherParts.push(`Not allowed: ${forbidden.map(f => `#${f.id}`).join(', ')}`);
  if (failed.length) otherParts.push(`Failed: ${failed.map(f => `#${f.id}`).join(', ')}`);
  if (skippedIds.length) otherParts.push(`Skipped (too many IDs): ${skippedIds.map(id => `#${id}`).join(', ')}`);

  const summary = new EmbedBuilder()
    .setTitle('Revert Summary')
    .addFields(
      { name: 'Restored', value: successIds, inline: false },
      ...(otherParts.length ? [{ name: 'Other', value: otherParts.join('\n'), inline: false }] : []) as any
    )
    .setColor(0x1ABC9C)
    .setTimestamp();
  pages.push({ embeds: [summary] });

  for (const d of restored) {
    const embed = new EmbedBuilder()
      .setTitle(`Restored Blame #${d.id}`)
      .addFields(
        { name: '**New Blame ID**', value: `#${d.id}`, inline: true },
        { name: '**Original ID**', value: `#${d.originalId}`, inline: true },
        { name: '**Insult**', value: d.insult, inline: true },
        { name: '**Note**', value: d.note ?? '—', inline: false },
        { name: '**Insulter**', value: userMention(d.userId), inline: true },
        { name: '**Blamer**', value: userMention(d.blamerId), inline: true },
        { name: '**When (original)**', value: '\u200E' + getShortTime(new Date(d.createdAt)), inline: false },
      )
      .setColor(0xF39C12)
      .setTimestamp(new Date(d.createdAt));
    pages.push({ embeds: [embed] });
  }

  const buildButtons = (page: number, total: number) => {
    const row = new ActionRowBuilder<ButtonBuilder>();
    row.addComponents(
      new ButtonBuilder().setCustomId('revert:first').setLabel('⏮').setStyle(ButtonStyle.Secondary).setDisabled(page === 1),
      new ButtonBuilder().setCustomId('revert:prev').setLabel('◀').setStyle(ButtonStyle.Secondary).setDisabled(page === 1),
      new ButtonBuilder().setCustomId('revert:next').setLabel('▶').setStyle(ButtonStyle.Secondary).setDisabled(page === total),
      new ButtonBuilder().setCustomId('revert:last').setLabel('⏭').setStyle(ButtonStyle.Secondary).setDisabled(page === total),
    );
    return [row];
  };

  const initialPage = 1;
  await interaction.editReply({ embeds: pages[initialPage - 1].embeds, components: buildButtons(initialPage, pages.length) });
  const sent = await interaction.fetchReply();
  sessionStore.set(sent.id, { pages, currentPage: initialPage });
  // Cleanup session after 15 minutes
  setTimeout(() => sessionStore.delete(sent.id), 15 * 60 * 1000);

  // Update insulter role after successful revert operations
  if (restored.length > 0) {
    await updateInsulterRoleAfterCommand(interaction.guild);
  }
}

export async function handleButton(customId: string, interaction: ButtonInteraction) {
  if (!customId.startsWith('revert:')) return;
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
    new ButtonBuilder().setCustomId('revert:first').setLabel('⏮').setStyle(ButtonStyle.Secondary).setDisabled(newPage === 1),
    new ButtonBuilder().setCustomId('revert:prev').setLabel('◀').setStyle(ButtonStyle.Secondary).setDisabled(newPage === 1),
    new ButtonBuilder().setCustomId('revert:next').setLabel('▶').setStyle(ButtonStyle.Secondary).setDisabled(newPage === totalPages),
    new ButtonBuilder().setCustomId('revert:last').setLabel('⏭').setStyle(ButtonStyle.Secondary).setDisabled(newPage === totalPages),
  );
  await interaction.update({ embeds: session.pages[newPage - 1].embeds, components: [row] });
}

// Export with spam protection
export const execute = withSpamProtection(executeCommand);
