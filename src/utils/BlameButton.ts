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
  MessageFlags,
  GuildMember
} from 'discord.js';
import { blameUser, BlameParams } from '../services/blame.js';
import { isDiscordAPIError, isInteractionInvalidError, getGuildMember } from './interactionValidation.js';
import { logGameplayAction } from './channelLogging.js';
import { canUseBotCommands } from './roleValidation.js';

export class BlameButton {
  static createBlameButton(): ButtonBuilder {
    return new ButtonBuilder()
      .setCustomId('blame:select-user')
      .setLabel('💀')
      .setStyle(ButtonStyle.Danger);
  }

  static createUserSelectMenu(): ActionRowBuilder<UserSelectMenuBuilder> {
    const selectMenu = new UserSelectMenuBuilder()
      .setCustomId('blame:user-selected')
      .setPlaceholder('Select a user to blame')
      .setMinValues(1)
      .setMaxValues(1);

    return new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(selectMenu);
  }

  static createBlameModal(targetUserId?: string, defaultInsult?: string, defaultNote?: string): ModalBuilder {
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

  static async handleUserSelect(interaction: UserSelectMenuInteraction): Promise<void> {
    if (interaction.customId !== 'blame:user-selected') return;

    // Check if already replied or deferred
    if (interaction.replied || interaction.deferred) {
      console.log(`User select interaction ${interaction.customId} already acknowledged, skipping`);
      return;
    }

    const selectedUser = interaction.users.first();
    if (!selectedUser) {
      try {
        await interaction.reply({ 
          content: 'No user selected. Please try again.', 
          flags: MessageFlags.Ephemeral
        });
      } catch (error) {
        // Only log if it's not an invalid interaction error
        if (!(isDiscordAPIError(error) && isInteractionInvalidError(error))) {
          console.log('Failed to reply to user select interaction (no user selected):', error);
        }
      }
      return;
    }

    // Check if user is trying to blame a bot
    if (selectedUser.bot) {
      try {
        await interaction.reply({ 
          content: 'You cannot blame bot users!', 
          flags: MessageFlags.Ephemeral
        });
      } catch (error) {
        // Only log if it's not an invalid interaction error
        if (!(isDiscordAPIError(error) && isInteractionInvalidError(error))) {
          console.log('Failed to reply to user select interaction (bot user):', error);
        }
      }
      return;
    }

    try {
      const modal = this.createBlameModal(selectedUser.id);
      await interaction.showModal(modal);
    } catch (error) {
      // Only log if it's not an invalid interaction error
      if (!(isDiscordAPIError(error) && isInteractionInvalidError(error))) {
        console.error('Error showing modal for user select:', error);
        try {
          if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ 
              content: 'An error occurred while opening the blame form. Please try again.', 
              flags: MessageFlags.Ephemeral
            });
          }
        } catch (replyError) {
          // Only log if it's not an invalid interaction error
          if (!(isDiscordAPIError(replyError) && isInteractionInvalidError(replyError))) {
            console.log('Failed to reply to user select interaction (modal error):', replyError);
          }
        }
      }
    }
  }


  static async handleModalSubmit(interaction: ModalSubmitInteraction): Promise<void> {
    if (!interaction.customId.startsWith('blame:modal-submit:')) return;

    // Check if already replied or deferred
    if (interaction.replied || interaction.deferred) {
      console.log(`Modal submit interaction ${interaction.customId} already acknowledged, skipping`);
      return;
    }

    const targetUserId = interaction.customId.split(':')[2];
    if (!targetUserId) {
      try {
        await interaction.reply({ 
          content: 'Error: Could not identify target user. Please try again.', 
          flags: MessageFlags.Ephemeral
        });
      } catch (error) {
        if (!(isDiscordAPIError(error) && isInteractionInvalidError(error))) {
          console.log('Failed to reply to modal submit (no target user):', error);
        }
      }
      return;
    }

    const guildId = interaction.guildId;
    if (!guildId) {
      try {
        await interaction.reply({ 
          content: 'This command can only be used in a server.', 
          flags: MessageFlags.Ephemeral
        });
      } catch (error) {
        if (!(isDiscordAPIError(error) && isInteractionInvalidError(error))) {
          console.log('Failed to reply to modal submit (no guild):', error);
        }
      }
      return;
    }

    const insult = interaction.fields.getTextInputValue('blame:insult');
    const note = interaction.fields.getTextInputValue('blame:note') || null;

    // Check role permissions
    let member: any = null;
    if (interaction.member instanceof GuildMember) {
      member = interaction.member;
    } else if (interaction.member && typeof interaction.member === 'object' && 'user' in interaction.member) {
      try {
        member = await interaction.guild!.members.fetch(interaction.member.user.id);
      } catch (error) {
        console.log('Failed to fetch member for role validation:', error);
      }
    }
    
    if (!member) {
      try {
        await interaction.reply({ 
          content: 'Unable to verify your permissions.', 
          flags: MessageFlags.Ephemeral
        });
      } catch (error) {
        if (!(isDiscordAPIError(error) && isInteractionInvalidError(error))) {
          console.log('Failed to reply to modal submit (no member):', error);
        }
      }
      return;
    }

    const roleCheck = await canUseBotCommands(member, true); // true = mutating command
    if (!roleCheck.allowed) {
      try {
        await interaction.reply({ 
          content: roleCheck.reason || 'You do not have permission to use this command.', 
          flags: MessageFlags.Ephemeral
        });
      } catch (error) {
        if (!(isDiscordAPIError(error) && isInteractionInvalidError(error))) {
          console.log('Failed to reply to modal submit (no permission):', error);
        }
      }
      return;
    }

    // Get the target user from the guild
    const targetUser = await interaction.guild!.members.fetch(targetUserId).catch(() => null);
    if (!targetUser) {
      try {
        await interaction.reply({ 
          content: 'Error: Could not find the selected user. They may have left the server.', 
          flags: MessageFlags.Ephemeral
        });
      } catch (error) {
        if (!(isDiscordAPIError(error) && isInteractionInvalidError(error))) {
          console.log('Failed to reply to modal submit (user not found):', error);
        }
      }
      return;
    }

    const blameParams: BlameParams = {
      guildId,
      guildName: interaction.guild!.name,
      target: targetUser.user,
      blamer: interaction.user,
      insultRaw: insult,
      noteRaw: note,
      dmTarget: true,
      guild: interaction.guild!
    };

    try {
      // Defer the reply since blameUser might take some time
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const result = await blameUser(blameParams);

      if (!result.ok) {
        await interaction.editReply({ 
          content: `Error: ${result.error.message}` 
        });
        return;
      }

      // Log the gameplay action to insults channel
      await logGameplayAction(interaction.guild!, {
        action: 'blame',
        target: targetUser.user,
        blamer: interaction.user,
        insult: insult,
        note: note || undefined,
        blameId: result.data.insultId,
        embed: result.data.publicEmbed,
        addReactions: true
      });

      // Send the public embed as a follow-up message (not a reply)
      const followUp = await interaction.followUp({ 
        embeds: [result.data.publicEmbed] 
      });

      // Add thumbs up/down reactions to the public message
      // Wait a moment for the message to be fully processed
      setTimeout(async () => {
        try {
          await followUp.react('👍');
          await followUp.react('👎');
        } catch (reactionError) {
          // Check if it's a Discord API error indicating the message doesn't exist
          if (isDiscordAPIError(reactionError) && (reactionError as any).code === 10008) {
            console.log('Message was deleted before reactions could be added, skipping');
          } else {
            console.log('Failed to add reactions to blame message:', reactionError);
          }
        }
      }, 1000);

      // Log DM status
      if (result.data.dmSent) {
        console.log(`DM sent to ${targetUser.user.username} for blame`);
      } else {
        console.log(`Failed to send DM to ${targetUser.user.username} for blame`);
      }
    } catch (error) {
      // Only log if it's not an invalid interaction error
      if (!(isDiscordAPIError(error) && isInteractionInvalidError(error))) {
        console.error('Error in modal submit handling:', error);
        try {
          if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ 
              content: 'An error occurred while processing your blame. Please try again.', 
              flags: MessageFlags.Ephemeral
            });
          } else if (interaction.deferred) {
            await interaction.editReply({ 
              content: 'An error occurred while processing your blame. Please try again.' 
            });
          }
        } catch (replyError) {
          if (!(isDiscordAPIError(replyError) && isInteractionInvalidError(replyError))) {
            console.log('Failed to reply to modal submit (error handling):', replyError);
          }
        }
      }
    }
  }
}
