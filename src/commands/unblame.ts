import { ChatInputCommandInteraction, SlashCommandBuilder, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { prisma } from '../database/client.js';

export const data = new SlashCommandBuilder()
  .setName('unblame')
  .setDescription('Delete a blame record by ID (you must be the blamer or admin)')
  .addIntegerOption(opt =>
    opt.setName('id').setDescription('Blame ID').setRequired(true)
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  const id = interaction.options.getInteger('id', true);
  const invokerId = interaction.user.id;

  const record = await prisma.insult.findUnique({ where: { id } });
  if (!record) {
    await interaction.reply({ content: `No record found for ID ${id}.`, ephemeral: true });
    return;
  }

  const member = await interaction.guild?.members.fetch(invokerId).catch(() => null);
  const isAdmin = member?.permissions.has(PermissionFlagsBits.Administrator) ?? false;

  if (record.blamerId !== invokerId && !isAdmin) {
    await interaction.reply({ content: 'You can only delete your own blames unless you are an admin.', flags: MessageFlags.Ephemeral });
    return;
  }

  await prisma.insult.delete({ where: { id } });
  await interaction.reply({ content: `Deleted blame #${id}.`, flags: MessageFlags.Ephemeral });
}


