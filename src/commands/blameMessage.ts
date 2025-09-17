import { ApplicationCommandType, ContextMenuCommandBuilder, MessageContextMenuCommandInteraction, MessageFlags } from 'discord.js';
import { BlameButton } from '../utils/BlameButton.js';

export const data = new ContextMenuCommandBuilder()
  .setName('Blame Message')
  .setType(ApplicationCommandType.Message);

export async function execute(interaction: MessageContextMenuCommandInteraction): Promise<void> {
  const guildId = interaction.guildId;
  if (!guildId) {
    await interaction.reply({ content: 'This command can only be used in a server.', flags: MessageFlags.Ephemeral });
    return;
  }

  const targetMessage = interaction.targetMessage;
  if (!targetMessage) {
    await interaction.reply({ content: 'Could not resolve the selected message.', flags: MessageFlags.Ephemeral });
    return;
  }

  const author = targetMessage.author;
  if (!author) {
    await interaction.reply({ content: 'Could not resolve the message author.', flags: MessageFlags.Ephemeral });
    return;
  }

  if (author.bot) {
    await interaction.reply({ content: 'You cannot blame bot users!', flags: MessageFlags.Ephemeral });
    return;
  }

  const content = (targetMessage.content && targetMessage.content.trim().length > 0) ? targetMessage.content.trim() : 'No content';
  const link = `https://discord.com/channels/${guildId}/${interaction.channelId}/${targetMessage.id}`;

  // Pre-fill note: quoted content then link on new line; ensure <= 1000 chars
  const prefilledNoteRaw = `"${content}"\n${link}`;
  const prefilledNote = prefilledNoteRaw.length > 1000 ? prefilledNoteRaw.slice(0, 1000) : prefilledNoteRaw;

  const modal = BlameButton.createBlameModal(author.id, undefined, prefilledNote);
  await interaction.showModal(modal);
}


