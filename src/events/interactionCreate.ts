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
import * as clear from '../commands/clear.js';
import * as config from '../commands/config.js';
import { BlameButton } from '../utils/BlameButton.js';


// Prevent double-processing of the same interaction (nodemon restarts, duplicate events, etc.)
const processedInteractionIds = new Set<string>();

export async function handleInteraction(interaction: Interaction) {
  console.log(`Processing interaction ${interaction.id} of type ${interaction.type}`);
  
  // Check if already processed first (fastest check)
  if (processedInteractionIds.has(interaction.id)) {
    console.log(`Skipping duplicate interaction: ${interaction.id}`);
    return;
  }

  // Check if already acknowledged (only for interactions that support it)
  if (interaction.isButton() || interaction.isUserSelectMenu() || interaction.isModalSubmit() || interaction.isChatInputCommand()) {
    if (interaction.replied || interaction.deferred) {
      console.log(`Skipping already acknowledged interaction: ${interaction.id}`);
      return;
    }
  }

  // Check if interaction has expired (Discord interactions expire after 3 seconds)
  if (isInteractionExpired(interaction)) {
    console.log(`Skipping expired interaction: ${interaction.id}`);
    return;
  }
  
  // Add to processed set immediately to prevent race conditions
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
      clear: clear.execute,
      config: config.execute,
    };

    const handler = map[interaction.commandName];
    if (!handler) return;
    
    try {
      await handler(interaction);
    } catch (error) {
      // Only log if it's not an invalid interaction error
      if (!(isDiscordAPIError(error) && isInteractionInvalidError(error))) {
        console.error(`Error handling slash command ${interaction.commandName}:`, error);
      }
      
      // Check if this is a Discord API error indicating the interaction is invalid
      if (isDiscordAPIError(error) && isInteractionInvalidError(error)) {
        console.log(`Slash command ${interaction.commandName} interaction is invalid, skipping error response`);
        return;
      }
      
      // Don't try to respond if the interaction is already acknowledged
      if (interaction.replied || interaction.deferred) {
        console.log(`Slash command ${interaction.commandName} already acknowledged, skipping error response`);
        return;
      }
      
      // Check if interaction is still valid before trying to respond with error
      if (isInteractionExpired(interaction)) {
        console.log(`Slash command ${interaction.commandName} has expired, skipping error response`);
        return;
      }
      
      try {
        await interaction.reply({ 
          content: 'An error occurred while processing your command. Please try again.', 
          flags: MessageFlags.Ephemeral
        });
      } catch (replyError) {
        // Only log if it's not an invalid interaction error
        if (!(isDiscordAPIError(replyError) && isInteractionInvalidError(replyError))) {
          console.log('Failed to reply to slash command:', replyError);
        }
      }
    }

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
      } else if (id === 'blame:select-user') {
        // Handle blame button click - show user select menu
        // Check if already replied or deferred
        if (button.replied || button.deferred) {
          console.log(`Button interaction ${id} already acknowledged, skipping`);
          return;
        }
        
        // Check if interaction has expired before attempting to respond
        if (isInteractionExpired(button)) {
          console.log(`Button interaction ${id} has expired, skipping`);
          return;
        }
        
        try {
          // Defer the reply first to prevent interaction expiration
          await button.deferReply({ flags: MessageFlags.Ephemeral });
          
          const userSelectRow = BlameButton.createUserSelectMenu();
          await button.editReply({
            content: 'Select a user to blame:',
            components: [userSelectRow]
          });
        } catch (error) {
          // If it's an invalid interaction error, just log and skip
          if (isDiscordAPIError(error) && isInteractionInvalidError(error)) {
            console.log(`Button interaction ${id} is invalid (expired or already acknowledged), skipping`);
            console.log(error);
            return;
          }
          // Re-throw other errors to be handled by the outer catch
          throw error;
        }
      }
    } catch (error) {
      // Only log if it's not an invalid interaction error
      if (!(isDiscordAPIError(error) && isInteractionInvalidError(error))) {
        console.error(`Error handling button interaction ${id}:`, error);
      }
      
      // Check if this is a Discord API error indicating the interaction is invalid
      if (isDiscordAPIError(error) && isInteractionInvalidError(error)) {
        console.log(`Button interaction ${id} is invalid (expired or already acknowledged), skipping error response`);
        console.log(error);
        return;
      }
      
      // Check if interaction has expired
      if (isInteractionExpired(button)) {
        console.log(`Button interaction ${id} has expired, skipping error response`);
        console.log(error);
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
          // Only log if it's not an invalid interaction error
          if (!(isDiscordAPIError(replyError) && isInteractionInvalidError(replyError))) {
            console.log('Failed to reply to button interaction:', replyError);
          }
        }
      }
    }
    return;
  }


  // String Select Menu interactions
  if (interaction.isStringSelectMenu()) {
    const stringSelect = interaction as StringSelectMenuInteraction;
    try {
      if (stringSelect.customId === 'help_command_select') {
        await help.handleStringSelect(stringSelect);
      }
    } catch (error) {
      // Only log if it's not an invalid interaction error
      if (!(isDiscordAPIError(error) && isInteractionInvalidError(error))) {
        console.error(`Error handling string select menu interaction ${stringSelect.customId}:`, error);
      }
      
      if (isDiscordAPIError(error) && isInteractionInvalidError(error)) {
        console.log(`String select menu interaction ${stringSelect.customId} is invalid, skipping error response`);
        return;
      }
      
      if (isInteractionExpired(stringSelect)) {
        console.log(`String select menu interaction ${stringSelect.customId} has expired, skipping error response`);
        return;
      }
      
      if (!stringSelect.replied && !stringSelect.deferred) {
        try {
          await stringSelect.reply({ 
            content: 'An error occurred while processing your request.', 
            flags: MessageFlags.Ephemeral
          });
        } catch (replyError) {
          // Only log if it's not an invalid interaction error
          if (!(isDiscordAPIError(replyError) && isInteractionInvalidError(replyError))) {
            console.log('Failed to reply to string select menu interaction:', replyError);
          }
        }
      }
    }
    return;
  }

  // User Select Menu interactions
  if (interaction.isUserSelectMenu()) {
    const userSelect = interaction as UserSelectMenuInteraction;
    try {
      await BlameButton.handleUserSelect(userSelect);
    } catch (error) {
      // Only log if it's not an invalid interaction error
      if (!(isDiscordAPIError(error) && isInteractionInvalidError(error))) {
        console.error(`Error handling user select menu interaction ${userSelect.customId}:`, error);
      }
      
      if (isDiscordAPIError(error) && isInteractionInvalidError(error)) {
        console.log(`User select menu interaction ${userSelect.customId} is invalid, skipping error response`);
        return;
      }
      
      if (isInteractionExpired(userSelect)) {
        console.log(`User select menu interaction ${userSelect.customId} has expired, skipping error response`);
        return;
      }
      
      if (!userSelect.replied && !userSelect.deferred) {
        try {
          await userSelect.reply({ 
            content: 'An error occurred while processing your request.', 
            flags: MessageFlags.Ephemeral
          });
        } catch (replyError) {
          // Only log if it's not an invalid interaction error
          if (!(isDiscordAPIError(replyError) && isInteractionInvalidError(replyError))) {
            console.log('Failed to reply to user select menu interaction:', replyError);
          }
        }
      }
    }
    return;
  }

  // Modal submit -> save
  if (interaction.isModalSubmit()) {
    const modal = interaction as ModalSubmitInteraction;
    const id = modal.customId;
    
    try {
      if (id.startsWith('blame:modal-submit:')) {
        await BlameButton.handleModalSubmit(modal);
      }
    } catch (error) {
      // Only log if it's not an invalid interaction error
      if (!(isDiscordAPIError(error) && isInteractionInvalidError(error))) {
        console.error(`Error handling modal submit interaction ${id}:`, error);
      }
      
      if (isDiscordAPIError(error) && isInteractionInvalidError(error)) {
        console.log(`Modal submit interaction ${id} is invalid, skipping error response`);
        return;
      }
      
      if (isInteractionExpired(modal)) {
        console.log(`Modal submit interaction ${id} has expired, skipping error response`);
        return;
      }
      
      if (!modal.replied && !modal.deferred) {
        try {
          await modal.reply({ 
            content: 'An error occurred while processing your request.', 
            flags: MessageFlags.Ephemeral
          });
        } catch (replyError) {
          // Only log if it's not an invalid interaction error
          if (!(isDiscordAPIError(replyError) && isInteractionInvalidError(replyError))) {
            console.log('Failed to reply to modal submit interaction:', replyError);
          }
        }
      }
    }
    return;
  }
}
