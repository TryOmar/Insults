import { ApplicationCommandType, ContextMenuCommandBuilder, UserContextMenuCommandInteraction, MessageFlags, GuildMember, APIInteractionGuildMember } from 'discord.js';
import { isUserFrozen, canUseMutatingCommands } from '../utils/roleValidation.js';
import { setupCache } from '../utils/setupCache.js';
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

  // Check role permissions
  let member: GuildMember | null = null;
  const rawMember = interaction.member;
  
  if (!rawMember) {
    await interaction.reply({ 
      content: 'Unable to verify your permissions.',
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  // If it's already a GuildMember, use it directly
  if (rawMember instanceof GuildMember) {
    member = rawMember;
  } else {
    // If it's an APIInteractionGuildMember, fetch the full GuildMember
    try {
      const guild = interaction.guild;
      if (!guild) {
        await interaction.reply({ 
          content: 'Unable to verify your permissions.',
          flags: MessageFlags.Ephemeral
        });
        return;
      }
      member = await guild.members.fetch((rawMember as APIInteractionGuildMember).user.id);
    } catch (error) {
      console.error('Failed to fetch GuildMember:', error);
      await interaction.reply({ 
        content: 'Unable to verify your permissions.',
        flags: MessageFlags.Ephemeral
      });
      return;
    }
  }

  // Fetch setup data for role validation
  const setup = await setupCache.getSetup(guildId);

  // Check role permissions using the fetched setup data
  const frozenCheck = await isUserFrozen(member, setup);
  if (!frozenCheck.allowed) {
    await interaction.reply({ 
      content: frozenCheck.reason || 'You cannot use this command.',
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const mutatingCheck = await canUseMutatingCommands(member, setup);
  if (!mutatingCheck.allowed) {
    await interaction.reply({ 
      content: mutatingCheck.reason || 'You do not have permission to use this command.',
      flags: MessageFlags.Ephemeral
    });
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
