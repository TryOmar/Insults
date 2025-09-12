import { ChatInputCommandInteraction, SlashCommandBuilder, EmbedBuilder, userMention } from 'discord.js';
import { prisma } from '../database/client.js';

export const data = new SlashCommandBuilder()
  .setName('blame')
  .setDescription('Record an insult against a user')
  .addUserOption((opt) =>
    opt.setName('user').setDescription('The insulted user').setRequired(true)
  )
  .addStringOption((opt) =>
    opt.setName('insult').setDescription('Word or short phrase (≤140 chars)').setRequired(true)
  )
  .addStringOption((opt) =>
    opt.setName('note').setDescription('Optional note (≤200 chars)').setRequired(false)
  );

function normalizeInput(value: string | null, maxLen: number): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return '';
  if (trimmed.length > maxLen) return trimmed.slice(0, maxLen);
  if (trimmed.includes('\n')) return trimmed.replace(/\n+/g, ' ');
  return trimmed;
}

export async function execute(interaction: ChatInputCommandInteraction) {
  const guildId = interaction.guildId;
  if (!guildId) {
    await interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
    return;
  }

  const target = interaction.options.getUser('user', true);
  const insultRaw = interaction.options.getString('insult', true);
  const noteRaw = interaction.options.getString('note', false);

  if (target.bot || interaction.user.bot) {
    await interaction.reply({ content: 'Bot users are not allowed for this command.', ephemeral: true });
    return;
  }

  const insult = normalizeInput(insultRaw, 140);
  const note = normalizeInput(noteRaw, 200);

  if (!insult) {
    await interaction.reply({ content: 'Insult must be 1–140 characters.', ephemeral: true });
    return;
  }

  // Upsert users to ensure relations exist
  await prisma.user.upsert({
    where: { id: target.id },
    update: { username: target.username },
    create: { id: target.id, username: target.username },
  });

  await prisma.user.upsert({
    where: { id: interaction.user.id },
    update: { username: interaction.user.username },
    create: { id: interaction.user.id, username: interaction.user.username },
  });

  const record = await prisma.insult.create({
    data: {
      guildId,
      userId: target.id,
      blamerId: interaction.user.id,
      insult,
      note: note && note.length > 0 ? note : null,
    },
  });

  const embed = new EmbedBuilder()
    .setTitle('Blame recorded')
    .addFields(
      { name: 'Insulted User', value: userMention(target.id), inline: true },
      { name: 'Blamed By', value: userMention(interaction.user.id), inline: true },
      { name: 'Insult', value: insult, inline: false },
      { name: 'Note', value: note && note.length > 0 ? note : '—', inline: false },
    )
    .setTimestamp(new Date(record.createdAt));

  await interaction.reply({ embeds: [embed] });
}
