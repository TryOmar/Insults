import { ChatInputCommandInteraction, SlashCommandBuilder, EmbedBuilder, userMention, MessageFlags } from 'discord.js';
import { prisma } from '../database/client.js';
import { renderTable, TableConfig } from '../utils/tableRenderer.js';
import { getShortTime } from '../utils/time.js';

export const data = new SlashCommandBuilder()
  .setName('archive')
  .setDescription('Show archived (unblamed) records')
  .addUserOption(opt =>
    opt.setName('user').setDescription('Filter by user involved (insulted/blamer/unblamer)').setRequired(false)
  )
  .addStringOption(opt =>
    opt
      .setName('role')
      .setDescription('Filter by role for the selected user')
      .addChoices(
        { name: 'insulted', value: 'insulted' },
        { name: 'blamer', value: 'blamer' },
        { name: 'unblamer', value: 'unblamer' },
      )
      .setRequired(false)
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  const guildId = interaction.guildId;
  if (!guildId) {
    await interaction.reply({ content: 'This command can only be used in a server.', flags: MessageFlags.Ephemeral });
    return;
  }

  const user = interaction.options.getUser('user', false);
  const role = interaction.options.getString('role', false) as ('insulted' | 'blamer' | 'unblamer' | null);

  let where: any = { guildId };
  if (user && role) {
    if (role === 'insulted') where.userId = user.id;
    else if (role === 'blamer') where.blamerId = user.id;
    else if (role === 'unblamer') where.unblamerId = user.id;
  } else if (user) {
    where = {
      guildId,
      OR: [
        { userId: user.id },
        { blamerId: user.id },
        { unblamerId: user.id },
      ],
    };
  }

  const entries = await prisma.archive.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  } as any);

  if (!entries.length) {
    await interaction.reply({ content: 'No archived records found for the given filters.', flags: MessageFlags.Ephemeral });
    return;
  }

  const headers = ['ID', 'Insulted', 'Blamer', 'Unblamer', 'Insult', 'Note', 'Blame Date', 'Unblamed At'];
  const rows = entries.map(e => [
    `#${e.id}`,
    userMention(e.userId),
    userMention(e.blamerId),
    userMention(e.unblamerId),
    e.insult,
    e.note ?? '—',
    '\u200E' + getShortTime(new Date(e.createdAt)),
    '\u200E' + getShortTime(new Date((e as any).unblamedAt ?? new Date())),
  ]);

  const config: TableConfig = {
    columns: [
      { maxWidth: 6 },   // ID
      { maxWidth: 10 },  // Insulted
      { maxWidth: 10 },  // Blamer
      { maxWidth: 10 },  // Unblamer
      { maxWidth: 18 },  // Insult
      { maxWidth: 18 },  // Note
      { maxWidth: 8 },   // Blame Date
      { maxWidth: 10 },  // Unblamed At
    ],
    emptyMessage: 'No archived records',
  };

  const table = renderTable(headers, rows, config);
  const embed = new EmbedBuilder()
    .setTitle('🗃️ Archive')
    .setDescription(table)
    .setColor(0x95A5A6)
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}


