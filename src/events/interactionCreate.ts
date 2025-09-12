import { Interaction, TextChannel, ButtonInteraction, ModalSubmitInteraction, StringSelectMenuInteraction, UserSelectMenuInteraction, MessageFlags } from 'discord.js';
import { isInteractionExpired, isDiscordAPIError, isInteractionInvalidError } from '../utils/interactionValidation.js';
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
    console.log(`Skipping duplicate interaction: ${interaction.id}`);
    return;
  }
  
  // Check if interaction has expired (Discord interactions expire after 3 seconds)
  if (isInteractionExpired(interaction)) {
    console.log(`Skipping expired interaction: ${interaction.id}`);
    return;
  }
  
  processedInteractionIds.add(interaction.id);
  
  // Clean up old interaction IDs to prevent memory leaks
  if (processedInteractionIds.size > 1000) {
    const idsArray = Array.from(processedInteractionIds);
    processedInteractionIds.clear();
    // Keep only the most recent 500 IDs
    idsArray.slice(-500).forEach(id => processedInteractionIds.add(id));
  }

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

  // Button interactions
  if (interaction.isButton()) {
    const button = interaction as ButtonInteraction;
    const id = button.customId;
    
    try {
      if (id.startsWith('unblame:')) {
        await unblame.handleButton(id, button);
      } else if (id.startsWith('revert:')) {
        await revert.handleButton(id, button);
      } else if (id.startsWith('history:')) {
        await history.handleButton(id, button);
      } else if (id.startsWith('rank:')) {
        await rank.handleButton(id, button);
      } else if (id.startsWith('insults:')) {
        await insults.handleButton(id, button);
      } else if (id.startsWith('archive:')) {
        await archive.handleButton(id, button);
      }
    } catch (error) {
      console.error(`Error handling button interaction ${id}:`, error);
      
      // Check if this is a Discord API error indicating the interaction is invalid
      if (isDiscordAPIError(error) && isInteractionInvalidError(error)) {
        console.log(`Button interaction ${id} is invalid (expired or already acknowledged), skipping error response`);
        return;
      }
      
      // Check if interaction has expired
      if (isInteractionExpired(button)) {
        console.log(`Button interaction ${id} has expired, skipping error response`);
        return;
      }
      
      // Try to acknowledge the interaction if it hasn't been acknowledged yet
      if (!button.replied && !button.deferred) {
        try {
          await button.reply({ 
            content: 'An error occurred while processing your request.', 
            flags: MessageFlags.Ephemeral 
          });
        } catch (replyError) {
          console.log('Failed to reply to button interaction:', replyError);
        }
      }
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
