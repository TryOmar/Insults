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

    // Create a simple modal with text inputs only
    const modal = new ModalBuilder()
      .setCustomId('form_modal_simple')
      .setTitle('Blame Form');

    const targetUser = new TextInputBuilder()
      .setCustomId('target_user')
      .setLabel('Target User ID')
      .setPlaceholder('Enter the user ID to blame')
      .setRequired(true)
      .setStyle(TextInputStyle.Short);

    const insult = new TextInputBuilder()
      .setCustomId('insult_text')
      .setLabel('Insult')
      .setPlaceholder('Enter the insult')
      .setRequired(true)
      .setStyle(TextInputStyle.Short);

    const note = new TextInputBuilder()
      .setCustomId('note_text')
      .setLabel('Optional Note')
      .setPlaceholder('Add extra context if needed')
      .setRequired(false)
      .setStyle(TextInputStyle.Paragraph);

    const row1 = new ActionRowBuilder<TextInputBuilder>().addComponents(targetUser);
    const row2 = new ActionRowBuilder<TextInputBuilder>().addComponents(insult);
    const row3 = new ActionRowBuilder<TextInputBuilder>().addComponents(note);
    modal.addComponents(row1, row2, row3);

    await interaction.showModal(modal);
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
      .setLabel('Insult')
      .setPlaceholder('Enter the insult')
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
  const guildId = interaction.guildId as string;

  try {
    // Handle different modal types
    let targetId: string | null = null;
    if (customId === 'form_modal_simple') {
      // For the simple modal, get target user ID from text input
      targetId = interaction.fields?.getTextInputValue('target_user')?.trim?.();
    } else if (customId === 'form_modal_v2') {
      // Legacy v2 modal handling (should not be used anymore)
      const comps = (interaction as any).components ?? [];
      for (const row of comps) {
        const component = row?.component ?? row?.components?.[0];
        if (!component) continue;
        const cid = component.custom_id ?? component.customId;
        if (cid === 'form_user_select' || cid === 'user_selected') {
          const values = component.values ?? [];
          if (Array.isArray(values) && values.length > 0) {
            targetId = values[0];
          }
        }
      }
    } else {
      // Legacy modal with user ID in custom ID
      const match = customId.match(/^form_modal_(\d+)$/);
      if (match) targetId = match[1];
    }

    const insult = interaction.fields?.getTextInputValue('insult_text')?.trim?.();
    const note = interaction.fields?.getTextInputValue('note_text')?.trim?.() || null;
    if (!insult) {
      await interaction.reply({ content: 'Insult is required.', flags: MessageFlags.Ephemeral });
      return;
    }
    if (!targetId) {
      await interaction.reply({ content: 'Please provide a valid user ID.', flags: MessageFlags.Ephemeral });
      return;
    }

    // Ensure users exist
    const targetUser = await interaction.client.users.fetch(targetId).catch(() => null);
    if (targetUser) {
      await prisma.user.upsert({ where: { id: targetId }, update: { username: targetUser.username }, create: { id: targetId, username: targetUser.username } });
    }
    await prisma.user.upsert({ where: { id: interaction.user.id }, update: { username: interaction.user.username }, create: { id: interaction.user.id, username: interaction.user.username } });

    await prisma.insult.create({
      data: {
        guildId,
        userId: targetId,
        blamerId: interaction.user.id,
        insult,
        note,
      }
    });

    await interaction.reply({ content: 'Blame recorded via form.', flags: MessageFlags.Ephemeral });
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


