import { 
  ChatInputCommandInteraction, 
  EmbedBuilder, 
  Guild, 
  User, 
  GuildMember,
  ChannelType
} from 'discord.js';
import { prisma } from '../database/client.js';

export interface GameplayLogData {
  action: 'blame' | 'unblame' | 'revert' | 'radar' | 'insulter-role-update';
  target?: User;
  blamer?: User;
  unblamer?: User;
  insult?: string;
  note?: string;
  blameId?: number;
  newInsulter?: User;
  oldInsulter?: User;
}

/**
 * Log a gameplay action to the insults channel
 */
export async function logGameplayAction(
  interaction: ChatInputCommandInteraction, 
  data: GameplayLogData
): Promise<void> {
  try {
    const setup = await prisma.setup.findUnique({
      where: { guildId: interaction.guildId! }
    });

    if (!setup?.insultsChannelId) {
      return; // Logging is disabled
    }

    const channel = interaction.guild?.channels.cache.get(setup.insultsChannelId);
    if (!channel?.isTextBased()) {
      return; // Channel not found or not text-based
    }

    const embed = createGameplayEmbed(data);
    await channel.send({ embeds: [embed] });
  } catch (error) {
    console.error('Failed to log gameplay action:', error);
  }
}

/**
 * Log a system notification to the monitor channel
 */
export async function logSystemNotification(
  guild: Guild,
  title: string,
  description: string,
  color: number = 0x5865F2
): Promise<void> {
  try {
    const setup = await prisma.setup.findUnique({
      where: { guildId: guild.id }
    });

    if (!setup?.monitorChannelId) {
      return; // Logging is disabled
    }

    const channel = guild.channels.cache.get(setup.monitorChannelId);
    if (!channel?.isTextBased()) {
      return; // Channel not found or not text-based
    }

    const embed = new EmbedBuilder()
      .setTitle(title)
      .setDescription(description)
      .setColor(color)
      .setTimestamp();

    await channel.send({ embeds: [embed] });
  } catch (error) {
    console.error('Failed to log system notification:', error);
  }
}

/**
 * Create an embed for gameplay actions
 */
function createGameplayEmbed(data: GameplayLogData): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTimestamp()
    .setColor(0x00ff00);

  switch (data.action) {
    case 'blame':
      embed
        .setTitle('🗡️ Blame Recorded')
        .setDescription(`**${data.blamer?.tag}** blamed **${data.target?.tag}**`)
        .addFields(
          { name: 'Insult', value: data.insult || 'N/A', inline: true },
          { name: 'ID', value: data.blameId?.toString() || 'N/A', inline: true }
        );
      if (data.note) {
        embed.addFields({ name: 'Note', value: data.note, inline: false });
      }
      break;

    case 'unblame':
      embed
        .setTitle('🗑️ Blame Removed')
        .setDescription(`**${data.unblamer?.tag}** removed blame #${data.blameId}`)
        .addFields(
          { name: 'Target', value: data.target?.tag || 'N/A', inline: true },
          { name: 'Original Blamer', value: data.blamer?.tag || 'N/A', inline: true }
        );
      break;

    case 'revert':
      embed
        .setTitle('↩️ Blame Restored')
        .setDescription(`**${data.unblamer?.tag}** restored blame #${data.blameId}`)
        .addFields(
          { name: 'Target', value: data.target?.tag || 'N/A', inline: true },
          { name: 'Original Blamer', value: data.blamer?.tag || 'N/A', inline: true }
        );
      break;

    case 'radar':
      embed
        .setTitle('📡 Radar Toggled')
        .setDescription(`**${data.blamer?.tag}** toggled automatic insult detection`);
      break;

    case 'insulter-role-update':
      embed
        .setTitle('👑 Top Insulter Changed')
        .setDescription(`**${data.newInsulter?.tag}** is now the top insulter`)
        .addFields(
          { name: 'Previous Top Insulter', value: data.oldInsulter?.tag || 'None', inline: true }
        );
      break;
  }

  return embed;
}

/**
 * Log role assignment issues
 */
export async function logRoleAssignmentIssue(
  guild: Guild,
  issue: string,
  details?: string
): Promise<void> {
  await logSystemNotification(
    guild,
    '⚠️ Role Assignment Issue',
    `${issue}${details ? `\n\nDetails: ${details}` : ''}`,
    0xff9900
  );
}

/**
 * Log configuration errors
 */
export async function logConfigurationError(
  guild: Guild,
  error: string,
  details?: string
): Promise<void> {
  await logSystemNotification(
    guild,
    '❌ Configuration Error',
    `${error}${details ? `\n\nDetails: ${details}` : ''}`,
    0xff0000
  );
}
