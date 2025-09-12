import { Interaction, TextChannel, ButtonInteraction, ModalSubmitInteraction, StringSelectMenuInteraction, UserSelectMenuInteraction } from 'discord.js';
import * as blame from '../commands/blame.js';
import * as rank from '../commands/rank.js';
import * as liveRank from '../commands/live_rank.js';
import * as detail from '../commands/detail.js';
import * as unblame from '../commands/unblame.js';
import * as help from '../commands/help.js';
import * as history from '../commands/history.js';
import * as insults from '../commands/insults.js';
import * as setup from '../commands/setup.js';

async function fetchChannelMessage(interaction: Interaction, channelId: string, messageId: string) {
  try {
    const channel = await interaction.client.channels.fetch(channelId);
    if (!channel || !channel.isTextBased()) return null;
    const msg = await (channel as TextChannel).messages.fetch(messageId);
    if (!msg) return null;
    return {
      edit: async (opts: any) => {
        await msg.edit(opts);
      },
    };
  } catch {
    return null;
  }
}

// Prevent double-processing of the same interaction (nodemon restarts, duplicate events, etc.)
const processedInteractionIds = new Set<string>();

export async function handleInteraction(interaction: Interaction) {
  if (processedInteractionIds.has(interaction.id)) {
    return;
  }
  processedInteractionIds.add(interaction.id);

  // Slash commands
  if (interaction.isChatInputCommand()) {
    const map: Record<string, (i: any) => Promise<void>> = {
      blame: blame.execute,
      rank: rank.execute,
      live_rank: liveRank.execute,
      detail: detail.execute,
      unblame: unblame.execute,
      help: help.execute,
      history: history.execute,
      insults: insults.execute,
      setup: setup.execute,
    };

    const handler = map[interaction.commandName];
    if (!handler) return;
    await handler(interaction);

    if ((interaction.commandName === 'blame' || interaction.commandName === 'unblame') && interaction.guildId) {
      await liveRank.refreshLiveRank(interaction.guildId, (channelId, messageId) => fetchChannelMessage(interaction, channelId, messageId));
    }
    return;
  }

  // Button -> open modal
  if (interaction.isButton()) {
    const button = interaction as ButtonInteraction;
    const id = button.customId;
    if (id.startsWith('setup:')) {
      await setup.handleButton(id, button);
    }
    return;
  }


  // Modal submit -> save
  if (interaction.isModalSubmit()) {
    const modal = interaction as ModalSubmitInteraction;
    const id = modal.customId;
    if (id === 'setup_form_modal') {
      await setup.handleModal(id, modal);
    }
    return;
  }
}
