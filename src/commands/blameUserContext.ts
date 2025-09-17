import { ApplicationCommandType, ContextMenuCommandBuilder, UserContextMenuCommandInteraction, MessageFlags } from 'discord.js';
import { BlameModal } from '../utils/BlameModal.js';

export const data = new ContextMenuCommandBuilder()
  .setName('Blame User')
  .setType(ApplicationCommandType.User);

export async function execute(interaction: UserContextMenuCommandInteraction): Promise<void> {
  const guildId = interaction.guildId;
  if (!guildId) {
    await interaction.reply({ content: 'This command can only be used in a server.', flags: MessageFlags.Ephemeral });
    return;
  }

  const targetUser = interaction.targetUser;
  if (!targetUser) {
    await interaction.reply({ content: 'Could not resolve the selected user.', flags: MessageFlags.Ephemeral });
    return;
  }

  if (targetUser.bot) {
    await interaction.reply({ content: 'You cannot blame bot users!', flags: MessageFlags.Ephemeral });
    return;
  }

  // Create modal without pre-filled content since we don't have a specific message
  const modal = BlameModal.create(targetUser.id);
  await interaction.showModal(modal);
}
