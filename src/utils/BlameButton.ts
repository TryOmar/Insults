import { 
  ActionRowBuilder, 
  ButtonBuilder, 
  ButtonStyle, 
  UserSelectMenuBuilder, 
  ModalBuilder, 
  TextInputBuilder, 
  TextInputStyle,
  UserSelectMenuInteraction,
  ModalSubmitInteraction,
  User,
  MessageFlags
} from 'discord.js';
import { blameUser, BlameParams } from '../services/blame.js';

export class BlameButton {
  static createBlameButton(): ButtonBuilder {
    return new ButtonBuilder()
      .setCustomId('blame:select-user')
      .setLabel('Blame')
      .setStyle(ButtonStyle.Danger)
      .setEmoji('💀');
  }

  static createUserSelectMenu(): ActionRowBuilder<UserSelectMenuBuilder> {
    const selectMenu = new UserSelectMenuBuilder()
      .setCustomId('blame:user-selected')
      .setPlaceholder('Select a user to blame')
      .setMinValues(1)
      .setMaxValues(1);

    return new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(selectMenu);
  }

  static createBlameModal(): ModalBuilder {
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

    const insultRow = new ActionRowBuilder<TextInputBuilder>().addComponents(insultInput);
    const noteRow = new ActionRowBuilder<TextInputBuilder>().addComponents(noteInput);

    return new ModalBuilder()
      .setCustomId('blame:modal-submit')
      .setTitle('Blame User')
      .addComponents(insultRow, noteRow);
  }

  static async handleUserSelect(interaction: UserSelectMenuInteraction): Promise<void> {
    if (interaction.customId !== 'blame:user-selected') return;

    const selectedUser = interaction.users.first();
    if (!selectedUser) {
      await interaction.reply({ 
        content: 'No user selected. Please try again.', 
        flags: MessageFlags.Ephemeral
      });
      return;
    }


    // Check if user is trying to blame a bot
    if (selectedUser.bot) {
      await interaction.reply({ 
        content: 'You cannot blame bot users!', 
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const modal = this.createBlameModal();
    
    // Store the selected user ID in the modal custom ID for later retrieval
    modal.setCustomId(`blame:modal-submit:${selectedUser.id}`);

    await interaction.showModal(modal);
  }

  static async handleModalSubmit(interaction: ModalSubmitInteraction): Promise<void> {
    if (!interaction.customId.startsWith('blame:modal-submit:')) return;

    const targetUserId = interaction.customId.split(':')[2];
    if (!targetUserId) {
      await interaction.reply({ 
        content: 'Error: Could not identify target user. Please try again.', 
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const guildId = interaction.guildId;
    if (!guildId) {
      await interaction.reply({ 
        content: 'This command can only be used in a server.', 
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const insult = interaction.fields.getTextInputValue('blame:insult');
    const note = interaction.fields.getTextInputValue('blame:note') || null;

    // Get the target user from the guild
    const targetUser = await interaction.guild!.members.fetch(targetUserId).catch(() => null);
    if (!targetUser) {
      await interaction.reply({ 
        content: 'Error: Could not find the selected user. They may have left the server.', 
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const blameParams: BlameParams = {
      guildId,
      guildName: interaction.guild!.name,
      target: targetUser.user,
      blamer: interaction.user,
      insultRaw: insult,
      noteRaw: note,
      dmTarget: true
    };

    // Defer the reply since blameUser might take some time
    await interaction.deferReply({ ephemeral: true });

    const result = await blameUser(blameParams);

    if (!result.ok) {
      await interaction.editReply({ 
        content: `Error: ${result.error.message}` 
      });
      return;
    }

    // Send the public embed as a follow-up message (not a reply)
    const followUp = await interaction.followUp({ 
      embeds: [result.data.publicEmbed] 
    });

    // Add thumbs up/down reactions to the public message
    try {
      await followUp.react('👍');
      await followUp.react('👎');
    } catch (reactionError) {
      console.log('Failed to add reactions to blame message:', reactionError);
    }

    // Log DM status
    if (result.data.dmSent) {
      console.log(`DM sent to ${targetUser.user.username} for blame`);
    } else {
      console.log(`Failed to send DM to ${targetUser.user.username} for blame`);
    }
  }
}
