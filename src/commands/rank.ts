import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';
import { buildLeaderboardEmbed } from '../utils/leaderboard.js';

export const data = new SlashCommandBuilder()
  .setName('rank')
  .setDescription('Show the current insult leaderboard');

export async function execute(interaction: ChatInputCommandInteraction) {
  const guildId = interaction.guildId;
  if (!guildId) {
    await interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
    return;
  }

  const embed = await buildLeaderboardEmbed(guildId);
  if (!embed) {
    await interaction.reply('No insults recorded yet.');
    return;
  }

  await interaction.reply({ embeds: [embed] });
}
