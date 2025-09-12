import { Interaction, TextChannel, ButtonInteraction, ModalSubmitInteraction, StringSelectMenuInteraction, UserSelectMenuInteraction } from 'discord.js';
import * as blame from '../commands/blame.js';
import * as rank from '../commands/rank.js';
import * as detail from '../commands/detail.js';
import * as unblame from '../commands/unblame.js';
import * as archive from '../commands/archive.js';
import * as revert from '../commands/revert.js';
import * as help from '../commands/help.js';
import * as history from '../commands/history.js';
import * as insults from '../commands/insults.js';
import * as radar from '../commands/radar.js';


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
      detail: detail.execute,
      unblame: unblame.execute,
      archive: archive.execute,
      revert: revert.execute,
      help: help.execute,
      history: history.execute,
      insults: insults.execute,
      radar: radar.execute,
    };

    const handler = map[interaction.commandName];
    if (!handler) return;
    await handler(interaction);

    return;
  }

  // Button -> open modal
  if (interaction.isButton()) {
    const button = interaction as ButtonInteraction;
    const id = button.customId;
    if (id.startsWith('unblame:')) {
      await unblame.handleButton(id, button);
    } else if (id.startsWith('revert:')) {
      await revert.handleButton(id, button);
    }
    return;
  }


  // Modal submit -> save
  if (interaction.isModalSubmit()) {
    const modal = interaction as ModalSubmitInteraction;
    const id = modal.customId;
    // No setup modals to handle anymore
    return;
  }
}
