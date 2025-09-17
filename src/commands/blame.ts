import { ChatInputCommandInteraction, SlashCommandBuilder, MessageFlags } from 'discord.js';
import { blameUser } from '../services/blame.js';
import { safeInteractionReply, getGuildMember } from '../utils/interactionValidation.js';
import { withSpamProtection } from '../utils/commandWrapper.js';
import { canUseBotCommands, isUserFrozen, canUseMutatingCommands } from '../utils/roleValidation.js';
import { logGameplayAction } from '../utils/channelLogging.js';
import { setupCache } from '../utils/setupCache.js';

export const data = new SlashCommandBuilder()
  .setName('blame')
  .setDescription('Record an insult against a user')
  .addUserOption((opt) =>
    opt.setName('user').setDescription('User who insulted').setRequired(true)
  )
  .addStringOption((opt) =>
    opt
      .setName('insult')
      .setDescription('Keep it short. Enter insult only. No descriptions, no sentences, no stories. Example: dog')
      .setRequired(true)
      .setMaxLength(100)
  )
  .addStringOption((opt) =>
    opt.setName('note').setDescription('Optional note. Add a sentence, description, or evidence if needed.').setRequired(false).setMaxLength(1000)
  );

async function executeCommand(interaction: ChatInputCommandInteraction) {
  const guildId = interaction.guildId;
  if (!guildId) {
    const success = await safeInteractionReply(interaction, { 
      content: 'This command can only be used in a server.', 
      flags: MessageFlags.Ephemeral 
    });
    if (!success) return;
    return;
  }

  // Defer the interaction immediately to show "thinking" state
  try {
    await interaction.deferReply();
  } catch (error) {
    // Ignore if already acknowledged
    console.warn('Failed to defer interaction:', error);
  }

  // Check role permissions
  const member = await getGuildMember(interaction);
  if (!member) {
    await interaction.editReply({ 
      content: 'Unable to verify your permissions.'
    });
    return;
  }

  // Fetch setup data once for both role validation and logging (with caching)
  const setup = await setupCache.getSetup(guildId);

  // Check role permissions using the fetched setup data
  const frozenCheck = await isUserFrozen(member, setup);
  if (!frozenCheck.allowed) {
    await interaction.editReply({ 
      content: frozenCheck.reason || 'You cannot use this command.'
    });
    return;
  }

  const mutatingCheck = await canUseMutatingCommands(member, setup);
  if (!mutatingCheck.allowed) {
    await interaction.editReply({ 
      content: mutatingCheck.reason || 'You do not have permission to use this command.'
    });
    return;
  }

  const target = interaction.options.getUser('user', true);
  const insultRaw = interaction.options.getString('insult', true);
  const noteRaw = interaction.options.getString('note', false);

  const result = await blameUser({
    guildId,
    guildName: interaction.guild?.name ?? null,
    target,
    blamer: interaction.user,
    insultRaw,
    noteRaw,
    dmTarget: true,
    guild: interaction.guild,
  });

  if (!result.ok) {
    await interaction.editReply({ 
      content: result.error.message
    });
    return;
  }

  // Send the public response directly (visible to everyone)
  await interaction.editReply({ 
    embeds: [result.data.publicEmbed] 
  });

  // Log the gameplay action using the fetched setup data
  await logGameplayAction(interaction, {
    action: 'blame',
    target,
    blamer: interaction.user,
    insult: insultRaw,
    note: noteRaw || undefined,
    blameId: result.data.insultId,
    embed: result.data.publicEmbed,
    addReactions: true
  }, setup);

  try {
    const sent = await interaction.fetchReply();
    // Add thumbs up/down reactions to the public message
    if ('react' in sent && typeof sent.react === 'function') {
      await sent.react('👍');
      await sent.react('👎');
    }
  } catch {
    // Ignore reaction failures (e.g., permissions)
  }
}

// Export with spam protection
export const execute = withSpamProtection(executeCommand);
