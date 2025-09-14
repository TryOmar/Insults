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

  const isAdmin = typeof member.permissions === 'string' ? false : member.permissions.has(PermissionFlagsBits.Administrator);

  type Result = 
    | { kind: 'restored'; id: number; originalId: number; insult: string; userId: string; blamerId: string; note: string | null; createdAt: Date }
    | { kind: 'not_found'; id: number }
    | { kind: 'forbidden'; id: number }
    | { kind: 'failed'; id: number };

  const results: Result[] = [];

  for (const id of ids) {
    const found = await (prisma as any).archive.findUnique({ where: { originalInsultId: id } });
    if (!found) {
      results.push({ kind: 'not_found', id });
      continue;
    }
    // Permission: allow original blamer or admin
    if (found.blamerId !== invokerId && !isAdmin) {
      results.push({ kind: 'forbidden', id });
      continue;
    }
    try {
      // Create the restored insult record
      const restoredInsult = await prisma.insult.create({
        data: {
          guildId: found.guildId,
          userId: found.userId,
          blamerId: found.blamerId,
          insult: found.insult,
          note: found.note ?? null,
          createdAt: new Date(found.createdAt),
        }
      });
      
      // Delete the archived record
      await (prisma as any).archive.delete({ where: { originalInsultId: id } });
      
      results.push({ 
        kind: 'restored', 
        id: restoredInsult.id, // Use the new ID from the restored record
        originalId: id, // Keep track of the original insult ID
        insult: found.insult, 
        userId: found.userId, 
        blamerId: found.blamerId, 
        note: found.note ?? null, 
        createdAt: new Date(found.createdAt) 
      });

      // Log the gameplay action
      await logGameplayAction(interaction, {
        action: 'revert',
        target: { id: found.userId } as any,
        blamer: { id: found.blamerId } as any,
        unblamer: interaction.user,
        blameId: restoredInsult.id
      });
    } catch {
      results.push({ kind: 'failed', id });
    }
  }

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
        { name: 'New ID', value: String(d.id), inline: true },
        { name: 'Original Insult ID', value: String(d.originalId), inline: true },
        { name: 'Insult', value: d.insult, inline: true },
        { name: 'Note', value: d.note ?? '—', inline: false },
        { name: 'Insulter', value: userMention(d.userId), inline: true },
        { name: 'Blamer', value: userMention(d.blamerId), inline: true },
        { name: 'When (original)', value: '\u200E' + getShortTime(new Date(d.createdAt)), inline: false },
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
      new ButtonBuilder().setCustomId('revert:next').setLabel('▶').setStyle(ButtonStyle.Secondary).setDisabled(page === pages.length),
      new ButtonBuilder().setCustomId('revert:last').setLabel('⏭').setStyle(ButtonStyle.Secondary).setDisabled(page === pages.length),
    );
    return [row];
  };

  const initialPage = 1;
  await interaction.reply({ embeds: pages[initialPage - 1].embeds });
  const sent = await interaction.fetchReply();
  sessionStore.set(sent.id, { pages, currentPage: initialPage });
  await interaction.editReply({ components: buildButtons(initialPage, pages.length) });

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
