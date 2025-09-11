import { ChatInputCommandInteraction, SlashCommandBuilder, TextChannel } from 'discord.js';
import { buildLeaderboardEmbed } from '../utils/leaderboard.js';

// Track the last live leaderboard message per guild
const guildToLiveMessage: Map<string, { channelId: string; messageId: string }> = new Map();

export const data = new SlashCommandBuilder()
  .setName('live_rank')
  .setDescription('Post a live-updating insult leaderboard in this channel');

export async function execute(interaction: ChatInputCommandInteraction) {
  const guildId = interaction.guildId;
  if (!guildId || !interaction.channel) {
    await interaction.reply({ content: 'Use this in a server text channel.', ephemeral: true });
    return;
  }

  const embed = await buildLeaderboardEmbed(guildId);
  if (!embed) {
    await interaction.reply('No insults recorded yet. Use /blame to add the first one.');
    return;
  }

  const sent = await interaction.reply({ embeds: [embed], fetchReply: true });
  guildToLiveMessage.set(guildId, { channelId: sent.channelId, messageId: sent.id });
}

export async function refreshLiveRank(guildId: string, fetchMessage: (channelId: string, messageId: string) => Promise<{ edit: (opts: any) => Promise<void> } | null>) {
  const info = guildToLiveMessage.get(guildId);
  if (!info) return;
  const embed = await buildLeaderboardEmbed(guildId);
  if (!embed) return;
  const msg = await fetchMessage(info.channelId, info.messageId);
  if (!msg) return;
  await msg.edit({ embeds: [embed] });
}
