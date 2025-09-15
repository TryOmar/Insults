import { ChatInputCommandInteraction, GuildMember, MessageFlags } from 'discord.js';
import { getGuildMember, safeInteractionReply } from './interactionValidation.js';
import { canUseBotCommands } from './roleValidation.js';

export type CommandContext = {
  guildId: string;
  invokerId: string;
  member: GuildMember;
};

/**
 * Common guild/auth/defer scaffolding for slash commands.
 * Returns a context or null if an early reply was sent due to validation failure.
 */
export async function withGuildAndAuth(
  interaction: ChatInputCommandInteraction,
  opts: { requiresMutating?: boolean; defer?: boolean } = {}
): Promise<CommandContext | null> {
  const { requiresMutating = false, defer = true } = opts;

  const guildId = interaction.guildId;
  if (!guildId) {
    await safeInteractionReply(interaction, {
      content: 'This command can only be used in a server.',
      flags: MessageFlags.Ephemeral,
    });
    return null;
  }

  const member = await getGuildMember(interaction);
  if (!member) {
    await safeInteractionReply(interaction, {
      content: 'Unable to verify your permissions.',
      flags: MessageFlags.Ephemeral,
    });
    return null;
  }

  const roleCheck = await canUseBotCommands(member, requiresMutating);
  if (!roleCheck.allowed) {
    await safeInteractionReply(interaction, {
      content: roleCheck.reason || 'You do not have permission to use this command.',
      flags: MessageFlags.Ephemeral,
    });
    return null;
  }

  if (defer) {
    try {
      await interaction.deferReply();
    } catch {
      // Ignore if already acknowledged elsewhere
    }
  }

  return {
    guildId,
    invokerId: interaction.user.id,
    member,
  };
}


