import { ChatInputCommandInteraction, SlashCommandBuilder, MessageFlags } from 'discord.js';
import { prisma } from '../database/client.js';
import { buildBlameEmbedFromRecord } from '../services/blame.js';
import { withSpamProtection } from '../utils/commandWrapper.js';

export const data = new SlashCommandBuilder()
  .setName('detail')
  .setDescription('Show full details for a blame record by ID')
  .addIntegerOption(opt =>
    opt.setName('id').setDescription('Blame ID').setRequired(true)
  );

async function executeCommand(interaction: ChatInputCommandInteraction) {
  const id = interaction.options.getInteger('id', true);
  const guildId = interaction.guildId;
  const guildName = interaction.guild?.name ?? 'Unknown guild';

  if (!guildId) {
    await interaction.reply({ content: 'This command can only be used in a server.', flags: MessageFlags.Ephemeral });
    return;
  }

  // First check active insults
  let record = await prisma.insult.findUnique({ where: { id, guildId } });
  let isArchived = false;

  // If not found in active insults, check archived insults by original insult ID
  if (!record) {
    const archivedRecord = await (prisma as any).archive.findUnique({ 
      where: { 
        originalInsultId: id,
        guildId: guildId
      } 
    });
    if (archivedRecord) {
      // Convert archived record to match the expected format
      record = {
        id: archivedRecord.originalInsultId, // Use the original insult ID
        guildId: archivedRecord.guildId,
        userId: archivedRecord.userId,
        blamerId: archivedRecord.blamerId,
        insult: archivedRecord.insult,
        note: archivedRecord.note,
        createdAt: new Date(archivedRecord.createdAt),
      };
      isArchived = true;
    }
  }

  if (!record) {
    await interaction.reply({ content: `No record found for ID ${id}.`, flags: MessageFlags.Ephemeral });
    return;
  }

  const embed = await buildBlameEmbedFromRecord('public', record, guildName);
  
  // Add "Archived" to the title if it's an archived record
  if (isArchived) {
    embed.setTitle(`🗃️ Archived - ${embed.data.title || 'Blame Details'}`);
  }

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

// Export with spam protection
export const execute = withSpamProtection('detail', executeCommand);


