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
  action: 'blame' | 'unblame' | 'revert' | 'radar' | 'radar-blame' | 'radar-delete' | 'radar-both' | 'insulter-role-update';
  target?: User;
  blamer?: User;
  unblamer?: User;
  insult?: string;
  note?: string;
  blameId?: number;
  newInsulter?: User;
  oldInsulter?: User;
  // New fields for reusing existing embeds
  embed?: EmbedBuilder;
  addReactions?: boolean;
  // Radar state
  radarMode?: string;
  // Radar specific fields
  originalMessage?: string;
}

/**
 * Log a gameplay action to the insults channel
 */
export async function logGameplayAction(
  interaction: ChatInputCommandInteraction, 
  data: GameplayLogData,
  setup?: any
): Promise<void>;
export async function logGameplayAction(
  guild: Guild, 
  data: GameplayLogData,
  setup?: any
): Promise<void>;
export async function logGameplayAction(
  interactionOrGuild: ChatInputCommandInteraction | Guild, 
  data: GameplayLogData,
  setup?: any
): Promise<void> {
  try {
    const guildId = 'guildId' in interactionOrGuild ? interactionOrGuild.guildId! : interactionOrGuild.id;
    const guild = 'guild' in interactionOrGuild ? interactionOrGuild.guild! : interactionOrGuild;
    
    // Use provided setup data or fetch it if not provided
    const setupData = setup || await prisma.setup.findUnique({ 
      where: { guildId },
      select: { insultsChannelId: true }
    });

    if (!setupData?.insultsChannelId) {
      return; // Logging is disabled
    }

    const channel = guild.channels.cache.get(setupData.insultsChannelId);
    if (!channel?.isTextBased()) {
      return; // Channel not found or not text-based
    }

    const embed = data.embed || createGameplayEmbed(data);
    const sentMessage = await channel.send({ embeds: [embed] });
    
    // Add reactions for blame messages if requested
    if (data.action === 'blame' && data.addReactions) {
      try {
        await sentMessage.react('👍');
        await sentMessage.react('👎');
      } catch (error) {
        console.error('Failed to add reactions to blame message:', error);
      }
    }
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
    const setup = await prisma.setup.findUnique({ where: { guildId: guild.id } });

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
      const radarMode = data.radarMode || 'off';
      const radarDescriptions = {
        'off': { status: 'disabled', emoji: '🔴', color: 0xff0000 },
        'blame': { status: 'set to blame mode', emoji: '🟡', color: 0xffff00 },
        'delete': { status: 'set to delete mode', emoji: '🟠', color: 0xff8800 },
        'both': { status: 'set to both mode', emoji: '🟢', color: 0x00ff00 }
      };
      const radarInfo = radarDescriptions[radarMode as keyof typeof radarDescriptions] || radarDescriptions.off;
      
      embed
        .setTitle(`${radarInfo.emoji} Radar ${radarMode === 'off' ? 'Disabled' : 'Mode Changed'}`)
        .setDescription(`**${data.blamer?.tag}** ${radarInfo.status} automatic insult detection`)
        .setColor(radarInfo.color);
      break;

    case 'radar-blame':
      // For radar-blame, we use the custom embed passed in (which is the normal blame embed)
      if (data.embed) {
        return data.embed;
      }
      // Fallback if no custom embed provided
      embed
        .setTitle('🚨 Radar Blame Recorded')
        .setDescription(`**${data.target?.tag}** was automatically blamed by radar`)
        .setColor(0x00B894) // Teal
        .addFields(
          { name: 'Insult', value: data.insult || 'N/A', inline: true },
          { name: 'Original Message', value: data.originalMessage ? `||${data.originalMessage.replace(/\n+/g, ' ').trim()}||` : 'N/A', inline: false }
        );
      break;

    case 'radar-delete':
      // For radar-delete, we use the custom embed passed in (which is the delete embed)
      if (data.embed) {
        return data.embed;
      }
      // Fallback if no custom embed provided
      embed
        .setTitle('🗑️ Radar Message Deleted')
        .setDescription(`Message from **${data.target?.tag}** was automatically deleted by radar`)
        .setColor(0xFF6B6B) // Light red
        .addFields(
          { name: 'Insult', value: data.insult || 'N/A', inline: true },
          { name: 'Original Message', value: data.originalMessage ? `||${data.originalMessage.replace(/\n+/g, ' ').trim()}||` : 'N/A', inline: false }
        );
      break;

    case 'radar-both':
      // For radar-both, we use the custom embed passed in (which is the blame embed with deletion note)
      if (data.embed) {
        return data.embed;
      }
      // Fallback if no custom embed provided
      embed
        .setTitle('⚡ Radar Action Taken')
        .setDescription(`**${data.target?.tag}** was automatically blamed and their message deleted by radar`)
        .setColor(0xFF8C00) // Dark orange
        .addFields(
          { name: 'Insult', value: data.insult || 'N/A', inline: true },
          { name: 'Original Message', value: data.originalMessage ? `||${data.originalMessage.replace(/\n+/g, ' ').trim()}||` : 'N/A', inline: false },
          { name: 'Actions Taken', value: '• Blame record created\n• Message deleted', inline: false }
        );
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
