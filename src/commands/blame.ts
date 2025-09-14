import { ChatInputCommandInteraction, SlashCommandBuilder, MessageFlags } from 'discord.js';
import { blameUser } from '../services/blame.js';
import { safeInteractionReply } from '../utils/interactionValidation.js';
import { withSpamProtection } from '../utils/commandWrapper.js';
import { canUseBotCommands } from '../utils/roleValidation.js';
import { logGameplayAction } from '../utils/channelLogging.js';

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

  // Check role permissions
  const member = interaction.member;
  if (!member || typeof member === 'string') {
    const success = await safeInteractionReply(interaction, { 
      content: 'Unable to verify your permissions.', 
      flags: MessageFlags.Ephemeral 
    });
    if (!success) return;
    return;
  }

  const roleCheck = await canUseBotCommands(member, true); // true = mutating command
  if (!roleCheck.allowed) {
    const success = await safeInteractionReply(interaction, { 
      content: roleCheck.reason || 'You do not have permission to use this command.', 
      flags: MessageFlags.Ephemeral 
    });
    if (!success) return;
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
    const success = await safeInteractionReply(interaction, { 
      content: result.error.message,
      flags: MessageFlags.Ephemeral 
    });
    if (!success) return;
    return;
  }

  // Send the public response directly (visible to everyone)
  const success = await safeInteractionReply(interaction, { 
    embeds: [result.data.publicEmbed] 
  });
  if (!success) return;

  // Log the gameplay action
  await logGameplayAction(interaction, {
    action: 'blame',
    target,
    blamer: interaction.user,
    insult: insultRaw,
    note: noteRaw || undefined,
    blameId: result.data.insultId
  });

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
