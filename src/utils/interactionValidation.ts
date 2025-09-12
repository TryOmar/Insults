import { Interaction, ChatInputCommandInteraction, ButtonInteraction } from 'discord.js';

/**
 * Checks if a Discord interaction has expired
 * Discord interactions expire after 3 seconds, we add a small buffer
 */
export function isInteractionExpired(interaction: Interaction): boolean {
  const now = Date.now();
  const interactionTime = interaction.createdTimestamp;
  const timeSinceCreation = now - interactionTime;
  
  // Add a small buffer (1 second) to account for processing time and network delays
  return timeSinceCreation > 4000; // 4 seconds
}

/**
 * Checks if an error is a Discord API error indicating an invalid interaction
 */
export function isDiscordAPIError(error: any): boolean {
  return error && typeof error === 'object' && 'code' in error && 'status' in error;
}

/**
 * Checks if an error indicates the interaction is invalid (expired or already acknowledged)
 */
export function isInteractionInvalidError(error: any): boolean {
  const invalidCodes = [10062, 40060]; // Unknown interaction, Already acknowledged
  return isDiscordAPIError(error) && invalidCodes.includes((error as any).code);
}

/**
 * Safely responds to an interaction with proper error handling
 * Returns true if the response was successful, false if the interaction was invalid
 */
export async function safeInteractionReply(
  interaction: ChatInputCommandInteraction | ButtonInteraction,
  response: any,
  isInitial: boolean = true
): Promise<boolean> {
  // Check if interaction has expired
  if (isInteractionExpired(interaction)) {
    console.log(`Interaction ${interaction.id} has expired, skipping response`);
    return false;
  }

  try {
    if (isInitial) {
      if (interaction.replied || interaction.deferred) {
        // For editReply, we need to remove flags that aren't supported
        const editResponse = { ...response };
        if (editResponse.flags) {
          delete editResponse.flags; // editReply doesn't support flags
        }
        await interaction.editReply(editResponse);
      } else {
        await interaction.reply(response);
      }
    } else {
      if ('update' in interaction) {
        // For update, we need to remove flags that aren't supported
        const updateResponse = { ...response };
        if (updateResponse.flags) {
          delete updateResponse.flags; // update doesn't support flags
        }
        await interaction.update(updateResponse);
      } else if ('editReply' in interaction) {
        // For editReply, we need to remove flags that aren't supported
        const editResponse = { ...response };
        if (editResponse.flags) {
          delete editResponse.flags; // editReply doesn't support flags
        }
        await interaction.editReply(editResponse);
      }
    }
    return true;
  } catch (error) {
    console.error(`Error responding to interaction ${interaction.id}:`, error);
    
    // Check if this is a Discord API error indicating the interaction is invalid
    if (isInteractionInvalidError(error)) {
      console.log(`Interaction ${interaction.id} is invalid (expired or already acknowledged), skipping error response`);
      return false;
    }
    
    // If it's not an invalid interaction error, log it but don't try to respond again
    console.log('Failed to respond to interaction:', error);
    return false;
  }
}
