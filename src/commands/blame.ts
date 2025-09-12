import { ChatInputCommandInteraction, SlashCommandBuilder, MessageFlags } from 'discord.js';
import { blameUser } from '../services/blame.js';
import { safeInteractionReply } from '../utils/interactionValidation.js';

export const data = new SlashCommandBuilder()
  .setName('blame')
  .setDescription('Record an insult against a user')
  .addUserOption((opt) =>
    opt.setName('user').setDescription('The insulted user').setRequired(true)
  )
  .addStringOption((opt) =>
    opt
      .setName('insult')
      .setDescription('Enter a single insult (up to 3 words).')
      .setRequired(true)
  )
  .addStringOption((opt) =>
    opt.setName('note').setDescription('Optional note (≤200 chars)').setRequired(false)
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  const guildId = interaction.guildId;
  if (!guildId) {
    const success = await safeInteractionReply(interaction, { 
      content: 'This command can only be used in a server.', 
      flags: MessageFlags.Ephemeral 
    });
    if (!success) return;
    return;
  }

  // Defer the interaction since we know this will take time due to database operations
  // We defer without ephemeral flag so the final response can be public
  const success = await safeInteractionReply(interaction, { 
    content: 'Processing your blame...' 
  });
  if (!success) return;

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
    }, false);
    if (!success) return;
    return;
  }

  // Edit the deferred message with the actual result (public response)
  const success2 = await safeInteractionReply(interaction, { 
    embeds: [result.data.publicEmbed] 
  }, false);
  if (!success2) return;

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
