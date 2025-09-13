import { ChatInputCommandInteraction, MessageFlags } from 'discord.js';
import { checkCooldown, getCooldownMessage } from './cooldown.js';
import { safeInteractionReply } from './interactionValidation.js';

/**
 * Generic wrapper that applies enhanced spam prevention to any command
 * Features: Global burst detection, progressive punishment, automatic cleanup
 * 
 * @param executeFunction The original command execute function
 * @returns Wrapped execute function with spam prevention
 */
export function withSpamProtection<T extends any[]>(
  executeFunction: (interaction: ChatInputCommandInteraction, ...args: T) => Promise<void>
) {
  return async (interaction: ChatInputCommandInteraction, ...args: T): Promise<void> => {
    // Check global burst limits and progressive punishment
    const cooldownCheck = checkCooldown(interaction.user);
    
    if (!cooldownCheck.allowed) {
      // Send user-friendly violation message
      const message = getCooldownMessage(
        cooldownCheck.remaining!, 
        cooldownCheck.reason!
      );
      
      await safeInteractionReply(interaction, {
        content: message,
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    try {
      // Execute the command
      await executeFunction(interaction, ...args);
    } catch (error) {
      // Don't record failed commands (allow retry)
      throw error;
    }
  };
}

/**
 * Apply spam protection to a command module (alternative to withSpamProtection)
 * @param commandModule The command module with execute function
 * @returns Modified command module with spam protection
 */
export function protectCommand(
  commandModule: { execute: (interaction: ChatInputCommandInteraction) => Promise<void> }
) {
  return {
    ...commandModule,
    execute: withSpamProtection(commandModule.execute)
  };
}
