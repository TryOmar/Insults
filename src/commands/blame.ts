import { ChatInputCommandInteraction, SlashCommandBuilder, EmbedBuilder, userMention } from 'discord.js';
import { prisma } from '../database/client.js';

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

  // Enforce single token with letters and digits only (Unicode letters allowed); no spaces or symbols
  if (!/^[\p{L}\p{Nd}]+$/u.test(insult)) {
    await interaction.reply({ content: 'Insult must be a single token with only letters and numbers. No spaces or symbols.', ephemeral: true });
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

  // Aggregations for feedback
  const totalBlames = await prisma.insult.count({ where: { guildId, userId: target.id } });
  const grouped = await prisma.insult.groupBy({
    by: ['insult'],
    where: { guildId, userId: target.id },
    _count: { insult: true },
    orderBy: [{ _count: { insult: 'desc' } }, { insult: 'asc' }],
  });
  const distinctPairs = grouped.map((g) => `${g.insult}(${g._count.insult})`);
  let distinctSummary = distinctPairs.join(', ');
  if (distinctSummary.length === 0) distinctSummary = '—';
  if (distinctSummary.length > 1000) {
    // Truncate safely to fit embed field limits
    const truncated: string[] = [];
    let used = 0;
    for (const part of distinctPairs) {
      const addLen = (truncated.length === 0 ? 0 : 2) + part.length; // include comma+space
      if (used + addLen > 1000) break;
      truncated.push(part);
      used += addLen;
    }
    const remaining = distinctPairs.length - truncated.length;
    distinctSummary = remaining > 0 ? `${truncated.join(', ')} … (+${remaining} more)` : truncated.join(', ');
  }

  const embed = new EmbedBuilder()
    .setTitle('Blame recorded')
    .addFields(
      { name: 'Insulted User', value: userMention(target.id), inline: true },
      { name: 'Blamed By', value: userMention(interaction.user.id), inline: true },
      { name: 'Insult', value: insult, inline: false },
      { name: 'Note', value: note && note.length > 0 ? note : '—', inline: false },
      { name: 'Total Blames', value: String(totalBlames), inline: true },
      { name: 'Total Insults', value: distinctSummary, inline: false },
    )
    .setTimestamp(new Date(record.createdAt));

  await interaction.reply({ embeds: [embed] });

  // Attempt to DM the insulted user with details
  try {
    const dmEmbed = new EmbedBuilder()
      .setTitle('You were blamed')
      .addFields(
        { name: 'Server', value: interaction.guild?.name ?? 'Unknown', inline: true },
        { name: 'By', value: userMention(interaction.user.id), inline: true },
        { name: 'Insult', value: insult, inline: false },
        { name: 'Note', value: note && note.length > 0 ? note : '—', inline: false },
        { name: 'Total Blames', value: String(totalBlames), inline: true },
        { name: 'Total Insults', value: distinctSummary, inline: false },
      )
      .setTimestamp(new Date(record.createdAt));
    await target.send({ embeds: [dmEmbed] });
  } catch {
    // User may have DMs closed; ignore silently
  }
}
