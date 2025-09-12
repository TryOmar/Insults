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

  const entries = await (prisma as any).archive.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  });

  if (!entries.length) {
    await interaction.reply({ content: 'No archived records found for the given filters.', flags: MessageFlags.Ephemeral });
    return;
  }

  // Fetch usernames for all users involved
  const userIds = [...new Set([
    ...entries.map((e: any) => e.userId),
    ...entries.map((e: any) => e.blamerId),
    ...entries.map((e: any) => e.unblamerId)
  ])];
  
  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, username: true }
  });
  
  const userMap = new Map(users.map(u => [u.id, u.username]));

  const headers = ['ID', 'Insult', 'Note', 'Insulter', 'Unblamer'];
  const rows = entries.map((e: any) => [
    `#${e.originalInsultId}`, // Show original insult ID
    e.insult,
    e.note ?? '—',
    `\u200E@${userMap.get(e.blamerId) ?? e.blamerId}`,
    `@${userMap.get(e.unblamerId) ?? e.unblamerId}`,
  ]);

  const config: TableConfig = {
    columns: [
      { maxWidth: 6 },  // ID
      { maxWidth: 12 }, // Insult
      { maxWidth: 12 }, // Note
      { maxWidth: 8 },  // Insulter
      { maxWidth: 8 },  // Unblamer
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


