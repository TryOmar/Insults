import { ChatInputCommandInteraction, PermissionFlagsBits, SlashCommandBuilder, MessageFlags } from 'discord.js';
import { prisma } from '../database/client.js';
import { withSpamProtection } from '../utils/commandWrapper.js';

export const data = new SlashCommandBuilder()
  .setName('radar')
  .setDescription('Toggle automatic insult radar on/off for this server')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addBooleanOption(o => o
    .setName('enabled')
    .setDescription('Enable or disable message scanning')
    .setRequired(true)
  );

async function executeCommand(interaction: ChatInputCommandInteraction) {
  if (!interaction.guildId) {
    await interaction.reply({ content: 'This command can only be used in a server.', flags: MessageFlags.Ephemeral });
    return;
  }

  const enabled = interaction.options.getBoolean('enabled', true);

  await prisma.setup.upsert({
    where: { guildId: interaction.guildId },
    update: ({ radarEnabled: enabled } as any),
    create: ({
      guildId: interaction.guildId,
      radarEnabled: enabled,
    } as any),
  });

  await interaction.reply({ content: `Radar is now ${enabled ? 'enabled' : 'disabled'} for this server.`, flags: MessageFlags.Ephemeral });
}

// Export with spam protection
export const execute = withSpamProtection(executeCommand);