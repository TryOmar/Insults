import { ChatInputCommandInteraction, SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, userMention, ButtonInteraction } from 'discord.js';
import { prisma } from '../database/client.js';
import { getShortTime } from '../utils/time.js';
import { withSpamProtection } from '../utils/commandWrapper.js';
import { logGameplayAction } from '../utils/channelLogging.js';
import { updateInsulterRoleAfterCommand } from '../utils/insulterRoleUpdate.js';
import { withGuildAndAuth } from '../utils/commandScaffold.js';
import { parseNumericIds } from '../utils/ids.js';
import { createSimplePager } from '../utils/simplePager.js';
import { buildSummaryEmbed } from '../utils/embeds.js';

export const data = new SlashCommandBuilder()
  .setName('revert')
  .setDescription('Restore archived blames back into active records')
  .addStringOption(opt =>
    opt.setName('id').setDescription('Archived blame ID').setRequired(true)
  );

type Page = { embeds: EmbedBuilder[] };
const pager = createSimplePager('revert');

async function executeCommand(interaction: ChatInputCommandInteraction) {
  const ctx = await withGuildAndAuth(interaction, { requiresMutating: true, defer: true });
  if (!ctx) return;

  const { guildId, invokerId, member } = ctx;

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
    | { kind: 'restored'; id: number; originalId: number; insult: string; userId: string; blamerId: string; note: string | null; createdAt: Date }
    | { kind: 'not_found'; id: number }
    | { kind: 'forbidden'; id: number }
    | { kind: 'failed'; id: number };

  const results: Result[] = [];
  // Batch-fetch archives for the requested original IDs, scoped to current guild
  const archives = await prisma.archive.findMany({ where: { originalInsultId: { in: processedIds }, guildId } });

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
      await prisma.archive.deleteMany({ where: { originalInsultId: { in: originalsToDelete }, guildId } });
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

  const summaryText = ['Restored: ' + successIds, ...(otherParts.length ? ['Other: ' + otherParts.join('\n')] : [])].join('\n');
  const summary = buildSummaryEmbed('Revert Summary', summaryText, 0x1ABC9C);
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

  const initialPage = 1;
  await pager.send(interaction, pages.map(p => p.embeds), initialPage);

  // Update insulter role after successful revert operations
  if (restored.length > 0) {
    await updateInsulterRoleAfterCommand(interaction.guild);
  }
}

export async function handleButton(customId: string, interaction: ButtonInteraction) {
  await pager.handleButton(customId, interaction);
}

// Export with spam protection
export const execute = withSpamProtection(executeCommand);
