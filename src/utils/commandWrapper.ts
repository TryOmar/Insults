import { ChatInputCommandInteraction, MessageFlags } from 'discord.js';
import { checkCooldown, setCooldown, formatCooldownTime } from './cooldown.js';
import { safeInteractionReply } from './interactionValidation.js';

// Default cooldown times for commands (in milliseconds)
const COMMAND_COOLDOWNS = {
  blame: 5000,     // 5 seconds - creates records
  unblame: 3000,   // 3 seconds - modifies records
  archive: 3000,   // 3 seconds - viewing command
  revert: 5000,    // 5 seconds - modifies records
  radar: 10000,    // 10 seconds - admin command
  help: 2000,      // 2 seconds - simple help
  history: 3000,   // 3 seconds - viewing command
  detail: 2000,    // 2 seconds - viewing command
  rank: 3000,      // 3 seconds - viewing command
  insults: 3000,   // 3 seconds - viewing command
} as const;

type CommandName = keyof typeof COMMAND_COOLDOWNS;

/**
 * Generic wrapper function that applies spam prevention to any command
 * @param commandName The name of the command
 * @param executeFunction The original command execute function
 * @returns Wrapped execute function with spam prevention
 */
export function withSpamProtection<T extends any[]>(
  commandName: CommandName,
  executeFunction: (interaction: ChatInputCommandInteraction, ...args: T) => Promise<void>
) {
  return async (interaction: ChatInputCommandInteraction, ...args: T): Promise<void> => {
    // Check cooldown
    const cooldownCheck = checkCooldown(interaction.user, commandName);
    if (cooldownCheck.isOnCooldown) {
      const success = await safeInteractionReply(interaction, {
        content: `⏰ Please wait ${formatCooldownTime(cooldownCheck.remainingTime)} before using this command again.`,
        flags: MessageFlags.Ephemeral
      });
      if (!success) return;
      return;
    }

    try {
      // Execute the original command
      await executeFunction(interaction, ...args);
      
      // Set cooldown after successful execution
      setCooldown(interaction.user, commandName);
    } catch (error) {
      // If command fails, don't set cooldown (allow retry)
      throw error;
    }
  };
}

/**
 * Apply spam protection to a command module
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
