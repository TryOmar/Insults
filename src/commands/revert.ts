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
import { setupCache } from '../utils/setupCache.js';

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
  // Batch-fetch archives for the requested original IDs, scoped to current guild
  const archives = await prisma.archive.findMany({ 
    where: { originalInsultId: { in: processedIds }, guildId },
    select: {
      originalInsultId: true,
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

  // Create insults for allowed in parallel, using original IDs
  let creations: PromiseSettledResult<any>[] = [];
  try {
    creations = await Promise.allSettled(allowed.map((a: any) => prisma.insult.create({
      data: {
        id: a.originalInsultId, // Use the original ID
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

  // Map created results by original id
  const createdByOriginal = new Map<number, any>();
  const failedCreations: number[] = [];
  creations.forEach((res, idx) => {
    const origId = allowed[idx].originalInsultId;
    if (res.status === 'fulfilled') {
      createdByOriginal.set(origId, res.value);
    } else {
      failedCreations.push(origId);
      results.push({ kind: 'failed', id: origId });
    }
  });

  // Bulk delete archives for successfully created ones in a single transaction
  const originalsToDelete = allowed.map((a: any) => a.originalInsultId).filter((oid: number) => createdByOriginal.has(oid));
  if (originalsToDelete.length > 0) {
    try {
      await prisma.archive.deleteMany({ where: { originalInsultId: { in: originalsToDelete }, guildId } });
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
  for (const oid of originalsToDelete) {
    const archive = allowedByOriginalId.get(oid);
    const restoredInsult = createdByOriginal.get(oid);
    if (!archive || !restoredInsult) continue;
    results.push({
      kind: 'restored',
      id: oid, // Now using the original ID since we restored with it
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
    summaryLines.push(`🟢 Restored: ${restored.map(d => d.id).join(', ')}`);
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

  // Build pages: only detail pages for restored items (no separate summary page)
  const pages: Page[] = [];

  for (const d of restored) {
    const embed = new EmbedBuilder()
      .setTitle(`Restored Blame ${d.id}`)
      .addFields(
        //{ name: '**Blame ID**', value: `${d.id}`, inline: true },
        { name: '**Insult**', value: d.insult, inline: true },
        { name: '**Reverter**', value: userMention(interaction.user.id), inline: true },
        { name: '**Note**', value: d.note ?? '—', inline: false },
        { name: '**Insulter**', value: userMention(d.userId), inline: true },
        { name: '**Blamer**', value: userMention(d.blamerId), inline: true },
        { name: '**When blamed**', value: `<t:${Math.floor(new Date(d.createdAt).getTime() / 1000)}:R>`, inline: false },
        { name: '**Summary**', value: summaryLines.join('\n') || 'No operations performed', inline: false }
      )
      .setColor(0xE67E22)
      .setTimestamp(new Date(d.createdAt));
    pages.push({ embeds: [embed] });
  }

  const initialPage = 0;
  
  // Create embed generator function for dynamic timestamps
  const embedGenerator = () => {
    const dynamicPages: Page[] = [];
    for (const d of restored) {
      const embed = new EmbedBuilder()
        .setTitle(`Restored Blame ${d.id}`)
        .addFields(
          //{ name: '**Blame ID**', value: `${d.id}`, inline: true },
          { name: '**Insult**', value: d.insult, inline: true },
          { name: '**Insulter**', value: userMention(d.userId), inline: true },
          { name: '**Note**', value: d.note ?? '—', inline: false },
          { name: '**Blamer**', value: userMention(d.blamerId), inline: true },
          { name: '**Reverter**', value: userMention(interaction.user.id), inline: true },
          { name: '**When blamed**', value: `<t:${Math.floor(new Date(d.createdAt).getTime() / 1000)}:R>`, inline: false },
          { name: '**Summary**', value: summaryLines.join('\n') || 'No operations performed', inline: false }
        )
        .setColor(0xE67E22)
        .setTimestamp(new Date(d.createdAt));
      dynamicPages.push({ embeds: [embed] });
    }
    return dynamicPages.map(p => p.embeds);
  };
  
  await pager.send(interaction, pages.map(p => p.embeds), initialPage, embedGenerator);

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
