import { ChatInputCommandInteraction, PermissionFlagsBits, SlashCommandBuilder, MessageFlags } from 'discord.js';
import { prisma } from '../database/client.js';

export const data = new SlashCommandBuilder()
  .setName('radar')
  .setDescription('Toggle automatic insult radar on/off for this server')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addBooleanOption(o => o
    .setName('enabled')
    .setDescription('Enable or disable message scanning')
    .setRequired(true)
  );

export async function execute(interaction: ChatInputCommandInteraction) {
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
      channelId: interaction.channelId,
      leaderboardMessageId: '0',
      radarEnabled: enabled,
    } as any),
  });

  await interaction.reply({ content: `Radar is now ${enabled ? 'enabled' : 'disabled'} for this server.`, flags: MessageFlags.Ephemeral });
}


