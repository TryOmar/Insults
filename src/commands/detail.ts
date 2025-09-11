import { ChatInputCommandInteraction, SlashCommandBuilder, EmbedBuilder, userMention, time, MessageFlags } from 'discord.js';
import { prisma } from '../database/client.js';

export const data = new SlashCommandBuilder()
  .setName('detail')
  .setDescription('Show full details for a blame record by ID')
  .addIntegerOption(opt =>
    opt.setName('id').setDescription('Blame ID').setRequired(true)
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  const id = interaction.options.getInteger('id', true);
  const guildName = interaction.guild?.name ?? 'Unknown guild';

  const record = await prisma.insult.findUnique({ where: { id } });
  if (!record) {
    await interaction.reply({ content: `No record found for ID ${id}.`, flags: MessageFlags.Ephemeral });
    return;
  }

  const [target, blamer] = await Promise.all([
    prisma.user.findUnique({ where: { id: record.userId }, select: { username: true, id: true } }),
    prisma.user.findUnique({ where: { id: record.blamerId }, select: { username: true, id: true } }),
  ]);

  const embed = new EmbedBuilder()
    .setTitle(`Blame #${record.id}`)
    .addFields(
      { name: 'Insult', value: record.insult, inline: false },
      { name: 'Note', value: record.note ?? '—', inline: false },
      { name: 'Blamer', value: blamer ? `${userMention(blamer.id)} (${blamer.username})` : 'Unknown', inline: true },
      { name: 'Target', value: target ? `${userMention(target.id)} (${target.username})` : 'Unknown', inline: true },
      { name: 'When', value: `${record.createdAt.toISOString()} (${time(record.createdAt, 'R')})`, inline: false },
      { name: 'Guild', value: guildName, inline: false },
    )
    .setTimestamp(record.createdAt);

  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}


