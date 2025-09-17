import { 
  ModalBuilder, 
  TextInputBuilder, 
  TextInputStyle,
  ActionRowBuilder
} from 'discord.js';

export class BlameModal {
  /**
   * Creates a blame modal with optional default values
   * @param targetUserId - The ID of the user being blamed
   * @param defaultInsult - Optional default insult text
   * @param defaultNote - Optional default note text
   * @returns Configured ModalBuilder
   */
  static create(targetUserId?: string, defaultInsult?: string, defaultNote?: string): ModalBuilder {
    const insultInput = new TextInputBuilder()
      .setCustomId('blame:insult')
      .setLabel('Insult (1-3 words)')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('Enter the insult...')
      .setRequired(true)
      .setMaxLength(140);

    const noteInput = new TextInputBuilder()
      .setCustomId('blame:note')
      .setLabel('Note (optional)')
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder('Add a note about this blame...')
      .setRequired(false)
      .setMaxLength(1000);

    // Apply default values if provided
    if (defaultInsult) {
      insultInput.setValue(defaultInsult);
    }
    if (typeof defaultNote === 'string' && defaultNote.length > 0) {
      noteInput.setValue(defaultNote);
    }

    const insultRow = new ActionRowBuilder<TextInputBuilder>().addComponents(insultInput);
    const noteRow = new ActionRowBuilder<TextInputBuilder>().addComponents(noteInput);

    const customId = targetUserId ? `blame:modal-submit:${targetUserId}` : 'blame:modal-submit';

    return new ModalBuilder()
      .setCustomId(customId)
      .setTitle('Blame User')
      .addComponents(insultRow, noteRow);
  }
}
