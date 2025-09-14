import { ChatInputCommandInteraction, SlashCommandBuilder, MessageFlags } from 'discord.js';
import { blameUser } from '../services/blame.js';
import { safeInteractionReply } from '../utils/interactionValidation.js';
import { withSpamProtection } from '../utils/commandWrapper.js';

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
