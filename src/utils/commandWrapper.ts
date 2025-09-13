import { ChatInputCommandInteraction, MessageFlags } from 'discord.js';
import { checkEnhancedCooldown, recordCommand, getCooldownMessage, type CommandName } from './cooldown.js';
import { safeInteractionReply } from './interactionValidation.js';

/**
 * Generic wrapper that applies enhanced spam prevention to any command
 * Features: Burst detection, progressive punishment, automatic cleanup
 * 
 * @param commandName The command name (must be in BASE_COOLDOWNS config)
 * @param executeFunction The original command execute function
 * @returns Wrapped execute function with spam prevention
 */
export function withSpamProtection<T extends any[]>(
  commandName: CommandName,
  executeFunction: (interaction: ChatInputCommandInteraction, ...args: T) => Promise<void>
) {
  return async (interaction: ChatInputCommandInteraction, ...args: T): Promise<void> => {
    // Check burst limits and progressive punishment
    const cooldownCheck = checkEnhancedCooldown(interaction.user, commandName);
    
    if (!cooldownCheck.allowed) {
      // Send user-friendly violation message
      const message = getCooldownMessage(
        cooldownCheck.reason!, 
        cooldownCheck.remainingTime!, 
        cooldownCheck.violationCount ?? 0
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
      
      // Record successful usage for burst tracking
      recordCommand(interaction.user, commandName);
    } catch (error) {
      // Don't record failed commands (allow retry)
      throw error;
    }
  };
}

/**
 * Apply spam protection to a command module (alternative to withSpamProtection)
 * @param commandModule The command module with execute function
 * @param commandName The command name for cooldown tracking
 * @returns Modified command module with spam protection
 */
export function protectCommand(
  commandModule: { execute: (interaction: ChatInputCommandInteraction) => Promise<void> },
  commandName: CommandName
) {
  return {
    ...commandModule,
    execute: withSpamProtection(commandName, commandModule.execute)
  };
}
