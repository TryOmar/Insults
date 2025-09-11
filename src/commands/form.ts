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

    // Open a modal that includes a User Select + text inputs using raw callback (components v2)
    const url = `https://discord.com/api/v10/interactions/${interaction.id}/${interaction.token}/callback`;
    const body = {
      type: 9,
      data: {
        custom_id: 'form_modal_v2',
        title: 'Blame Form',
        components: [
          {
            type: 18, // Label
            label: 'Choose user to blame',
            component: {
              type: 5, // USER_SELECT
              custom_id: 'form_user_select',
              max_values: 1,
              required: true,
              placeholder: 'Select a user'
            }
          },
          {
            type: 18,
            label: 'Insult',
            component: {
              type: 4, // TEXT_INPUT
              custom_id: 'insult_text',
              style: 1, // Short
              required: true,
              placeholder: 'Enter the insult'
            }
          },
          {
            type: 18,
            label: 'Optional Note',
            component: {
              type: 4, // TEXT_INPUT
              custom_id: 'note_text',
              style: 2, // Paragraph
              required: false,
              placeholder: 'Add extra context if needed'
            }
          }
        ]
      }
    } as any;
    console.log('[FORM] sending modal callback...');
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    console.log('[FORM] modal callback status:', res.status);
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      console.error('[FORM] modal callback failed:', res.status, txt);
    }
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
  try {
    // If this is the v2 modal, extract the selected user from submitted components
    let targetId: string | null = null;
    if (customId === 'form_modal_v2') {
      console.log('[FORM] ===== MODAL SUBMISSION DEBUG =====');
      console.log('[FORM] Raw interaction object keys:', Object.keys(interaction));
      console.log('[FORM] Interaction data:', JSON.stringify((interaction as any).data, null, 2));
      console.log('[FORM] Interaction components:', JSON.stringify((interaction as any).components, null, 2));
      
      // Try different ways to extract the user selection
      const comps = (interaction as any).components ?? [];
      console.log('[FORM] Components found:', comps.length);
      
      for (let i = 0; i < comps.length; i++) {
        const row = comps[i];
        console.log(`[FORM] Row ${i}:`, JSON.stringify(row, null, 2));
        
        const component = row?.component ?? row?.components?.[0];
        if (!component) continue;
        
        const cid = component.custom_id ?? component.customId;
        console.log(`[FORM] Component custom_id: ${cid}`);
        
        if (cid === 'form_user_select' || cid === 'user_selected') {
          const values = component.values ?? [];
          console.log('[FORM] Component values:', values);
          if (Array.isArray(values) && values.length > 0) {
            targetId = values[0];
            console.log('[FORM] ✅ Found target user ID:', targetId);
          }
        }
      }
      
      // Also try accessing raw data
      const rawData = (interaction as any).data;
      if (rawData) {
        console.log('[FORM] Raw data components:', JSON.stringify(rawData.components, null, 2));
      }
    } else {
      const match = customId.match(/^form_modal_(\d+)$/);
      if (match) targetId = match[1];
    }

    const insult = interaction.fields?.getTextInputValue('insult_text')?.trim?.();
    const note = interaction.fields?.getTextInputValue('note_text')?.trim?.() || null;
    
    // Console log all the extracted data
    console.log('[FORM] ===== EXTRACTED FORM DATA =====');
    console.log('[FORM] Custom ID:', customId);
    console.log('[FORM] Target User ID:', targetId);
    console.log('[FORM] Insult:', insult);
    console.log('[FORM] Note:', note);
    console.log('[FORM] Submitted by:', interaction.user.id, '(', interaction.user.username, ')');
    console.log('[FORM] Guild ID:', interaction.guildId);
    console.log('[FORM] ===== END FORM DATA =====');

    // Just reply that we received the data - don't actually process it
    let responseMessage = '✅ **Form submitted successfully!**\n\n**Data received:**\n';
    responseMessage += `• **Target User ID:** ${targetId || 'Not found'}\n`;
    responseMessage += `• **Insult:** ${insult || 'None'}\n`;
    responseMessage += `• **Note:** ${note || 'None'}\n`;
    responseMessage += `\n*Check console for detailed logs*`;

    await interaction.reply({ 
      content: responseMessage, 
      flags: MessageFlags.Ephemeral 
    });

  } catch (err) {
    console.error('[FORM] modal submission processing failed:', err);
    try { 
      await interaction.reply({ 
        content: 'Form submitted but had an error processing. Check console logs.', 
        flags: MessageFlags.Ephemeral 
      }); 
    } catch {}
  }
}