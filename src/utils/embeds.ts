import { EmbedBuilder } from 'discord.js';

export function buildSummaryEmbed(title: string, summaryText: string, color: number): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle(title)
    .setDescription(summaryText)
    .setColor(color)
    .setTimestamp();
}

export function buildDetailEmbed(
  title: string,
  fields: { name: string; value: string; inline?: boolean }[],
  color: number,
  timestamp?: Date
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle(title)
    .addFields(fields)
    .setColor(color);

  if (timestamp) {
    embed.setTimestamp(timestamp);
  }
  return embed;
}


