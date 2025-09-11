import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChatInputCommandInteraction, ModalBuilder, SlashCommandBuilder, UserSelectMenuBuilder, TextInputBuilder, TextInputStyle, MessageFlags } from 'discord.js';
// No recent users dependency; use Discord's built-in User Select
import { prisma } from '../database/client.js';
import * as liveRank from './live_rank.js';

export const data = new SlashCommandBuilder()
  .setName('form')
  .setDescription('Open buttons to blame a recent user via a form');

export async function execute(interaction: ChatInputCommandInteraction) {
  const startedAt = Date.now();
  console.log('[FORM] /form invoked by', interaction.user.id, 'in guild', interaction.guildId);
  try {
    if (!interaction.guildId) {
      await interaction.reply({ content: 'Use this in a server.', flags: MessageFlags.Ephemeral });
      return;
    }
    // Reply with a native User Select in the message, then open a text-input modal on selection
    const select = new UserSelectMenuBuilder()
      .setCustomId('form_user_select')
      .setPlaceholder('Select a user')
      .setMinValues(1)
      .setMaxValues(1);
    const row = new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(select);
    await interaction.reply({ content: 'Pick a user to blame:', components: [row], flags: MessageFlags.Ephemeral });
  } catch (err) {
    console.error('[FORM] /form failed:', err);
    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply('Something went wrong while opening the form.');
      } else {
        await interaction.reply({ content: 'Something went wrong while opening the form.', flags: MessageFlags.Ephemeral });
      }
    } catch {}
  } finally {
    console.log('[FORM] /form completed in', Date.now() - startedAt, 'ms');
  }
}

export async function handleButton(customId: string, interaction: any) {
  const match = customId.match(/^form_user_(\d+)$/);
  if (!match) return;
  const targetId = match[1];

  try {
    const modal = new ModalBuilder()
      .setCustomId(`form_modal_${targetId}`)
      .setTitle('Blame Form');

    const insult = new TextInputBuilder()
      .setCustomId('insult_text')
      .setLabel('Insult (letters only)')
      .setPlaceholder('Single word with letters only (no spaces, symbols, or numbers)')
      .setRequired(true)
      .setStyle(TextInputStyle.Short);

    const note = new TextInputBuilder()
      .setCustomId('note_text')
      .setLabel('Optional Note')
      .setPlaceholder('Add extra context if needed')
      .setRequired(false)
      .setStyle(TextInputStyle.Paragraph);

    const row1 = new ActionRowBuilder<TextInputBuilder>().addComponents(insult);
    const row2 = new ActionRowBuilder<TextInputBuilder>().addComponents(note);
    modal.addComponents(row1, row2);

    await interaction.showModal(modal);
  } catch (err) {
    console.error('[FORM] opening modal failed:', err);
    try { await interaction.reply({ content: 'Could not open form modal.', flags: MessageFlags.Ephemeral }); } catch {}
  }
}

export async function handleModal(customId: string, interaction: any) {
  const match = customId.match(/^form_modal_(\d+)$/);
  if (!match) return;
  const targetId = match[1];
  const guildId = interaction.guildId as string;

  try {
    const insult = interaction.fields.getTextInputValue('insult_text')?.trim();
    const note = interaction.fields.getTextInputValue('note_text')?.trim() || null;
    if (!insult) {
      await interaction.reply({ content: 'Insult is required.', flags: MessageFlags.Ephemeral });
      return;
    }
    if (insult.length > 140) {
      await interaction.reply({ content: 'Insult must be ≤ 140 characters.', flags: MessageFlags.Ephemeral });
      return;
    }
    if (!/^[a-zA-Z]+$/.test(insult)) {
      await interaction.reply({ content: 'Insult must be a single word containing only letters (no spaces, symbols, or numbers).', flags: MessageFlags.Ephemeral });
      return;
    }

    // Ensure users exist
    const targetUser = await interaction.client.users.fetch(targetId).catch(() => null);
    if (targetUser) {
      await prisma.user.upsert({ where: { id: targetId }, update: { username: targetUser.username }, create: { id: targetId, username: targetUser.username } });
    }
    await prisma.user.upsert({ where: { id: interaction.user.id }, update: { username: interaction.user.username }, create: { id: interaction.user.id, username: interaction.user.username } });

    const record = await prisma.insult.create({
      data: {
        guildId,
        userId: targetId,
        blamerId: interaction.user.id,
        insult,
        note,
      }
    });

    // Aggregations for feedback
    const totalBlames = await prisma.insult.count({ where: { guildId, userId: targetId } });
    const grouped = await prisma.insult.groupBy({
      by: ['insult'],
      where: { guildId, userId: targetId },
      _count: { insult: true },
      orderBy: [{ _count: { insult: 'desc' } }, { insult: 'asc' }],
    });
    const distinctPairs = grouped.map((g) => `${g.insult}(${g._count.insult})`);
    let distinctSummary = distinctPairs.join(', ');
    if (distinctSummary.length === 0) distinctSummary = '—';
    if (distinctSummary.length > 1000) {
      const truncated: string[] = [];
      let used = 0;
      for (const part of distinctPairs) {
        const addLen = (truncated.length === 0 ? 0 : 2) + part.length;
        if (used + addLen > 1000) break;
        truncated.push(part);
        used += addLen;
      }
      const remaining = distinctPairs.length - truncated.length;
      distinctSummary = remaining > 0 ? `${truncated.join(', ')} … (+${remaining} more)` : truncated.join(', ');
    }

    await interaction.reply({ content: `Blame recorded via form. Total blames: ${totalBlames}. Distinct insults (latest up to 10): ${distinctSummary}`, flags: MessageFlags.Ephemeral });

    // Attempt to DM the insulted user with details
    try {
      const dmUser = await interaction.client.users.fetch(targetId);
      const dmEmbed = {
        title: 'You were blamed',
        fields: [
          { name: 'Server', value: interaction.guild?.name ?? 'Unknown', inline: true },
          { name: 'By', value: `<@${interaction.user.id}>`, inline: true },
          { name: 'Insult', value: insult, inline: false },
          { name: 'Note', value: note ?? '—', inline: false },
          { name: 'Total Blames', value: String(totalBlames), inline: true },
          { name: 'Total Insults', value: distinctSummary, inline: false },
        ],
        timestamp: new Date(record.createdAt).toISOString(),
      } as any;
      await dmUser.send({ embeds: [dmEmbed] });
    } catch {
      // User may have DMs closed; ignore silently
    }
  } catch (err) {
    console.error('[FORM] saving modal submission failed:', err);
    try { await interaction.reply({ content: 'Could not save your form submission.', flags: MessageFlags.Ephemeral }); } catch {}
  }

  // Update live rank if present
  if (guildId) {
    await liveRank.refreshLiveRank(guildId, async (channelId: string, messageId: string) => {
      try {
        const channel = await interaction.client.channels.fetch(channelId);
        if (!channel || !channel.isTextBased()) return null;
        const msg = await (channel as any).messages.fetch(messageId);
        return msg ?? null;
      } catch {
        return null;
      }
    });
  }
}


