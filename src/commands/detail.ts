import { ChatInputCommandInteraction, SlashCommandBuilder, MessageFlags } from 'discord.js';
import { prisma } from '../database/client.js';
import { buildBlameEmbedFromRecord } from '../services/blame.js';

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

  const embed = await buildBlameEmbedFromRecord('public', record, guildName);
  await interaction.reply({ embeds: [embed] });
  const sent = await interaction.fetchReply();
  try {
    if ('react' in sent && typeof sent.react === 'function') {
      await sent.react('👍');
      await sent.react('👎');
    }
  } catch {
    // ignore reaction failures
  }
}


