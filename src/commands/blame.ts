import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';
import { blameUser } from '../services/blame.js';

export const data = new SlashCommandBuilder()
  .setName('blame')
  .setDescription('Record an insult against a user')
  .addUserOption((opt) =>
    opt.setName('user').setDescription('The insulted user').setRequired(true)
  )
  .addStringOption((opt) =>
    opt.setName('insult').setDescription('Single token: letters and numbers allowed. No spaces or symbols.').setRequired(true)
  )
  .addStringOption((opt) =>
    opt.setName('note').setDescription('Optional note (≤200 chars)').setRequired(false)
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  const guildId = interaction.guildId;
  if (!guildId) {
    await interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
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
    await interaction.reply({ content: result.error.message, ephemeral: true });
    return;
  }

  await interaction.reply({ embeds: [result.data.publicEmbed] });
}
