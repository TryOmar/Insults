import { Interaction, ChatInputCommandInteraction, ButtonInteraction, GuildMember, APIInteractionGuildMember } from 'discord.js';

/**
 * Safely gets a GuildMember from an interaction, fetching it if necessary
 * Returns null if the member cannot be obtained
 */
export async function getGuildMember(interaction: ChatInputCommandInteraction | ButtonInteraction): Promise<GuildMember | null> {
  if (!interaction.guildId) {
    return null;
  }

  const member = interaction.member;
  if (!member) {
    return null;
  }

  // If it's already a GuildMember, return it
  if (member instanceof GuildMember) {
    return member;
  }

  // If it's an APIInteractionGuildMember, we need to fetch the full GuildMember
  if (typeof member === 'object' && 'user' in member) {
    try {
      const guild = interaction.guild;
      if (!guild) {
        return null;
      }
      return await guild.members.fetch(member.user.id);
    } catch (error) {
      console.error('Failed to fetch GuildMember:', error);
      return null;
    }
  }

  return null;
}
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
  const invalidCodes = [10062, 40060, 10008]; // Unknown interaction, Already acknowledged, Unknown Message
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
