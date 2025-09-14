import { 
  ChatInputCommandInteraction, 
  SlashCommandBuilder, 
  MessageFlags, 
  EmbedBuilder,
  PermissionFlagsBits,
  Role,
  ChannelType
} from 'discord.js';
import { prisma } from '../database/client.js';
import { safeInteractionReply } from '../utils/interactionValidation.js';
import { withSpamProtection } from '../utils/commandWrapper.js';

export const data = new SlashCommandBuilder()
  .setName('config')
  .setDescription('Configure bot settings for this server')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addStringOption(option =>
    option
      .setName('action')
      .setDescription('What to configure')
      .setRequired(true)
      .addChoices(
        { name: 'Set Blamer Role', value: 'blamer-role' },
        { name: 'Set Frozen Role', value: 'frozen-role' },
        { name: 'Set Insulter Role', value: 'insulter-role' },
        { name: 'Set Insulter Days', value: 'insulter-days' },
        { name: 'Set Monitor Channel', value: 'monitor-channel' },
        { name: 'Set Insults Channel', value: 'insults-channel' },
        { name: 'View Configuration', value: 'view' }
      )
  )
  .addRoleOption(option =>
    option
      .setName('role')
      .setDescription('Role to assign (for blamer/frozen/insulter roles)')
      .setRequired(false)
  )
  .addIntegerOption(option =>
    option
      .setName('days')
      .setDescription('Number of days for insulter role calculation (0 = all-time)')
      .setRequired(false)
      .setMinValue(0)
      .setMaxValue(3650)
  )
  .addChannelOption(option =>
    option
      .setName('channel')
      .setDescription('Channel for logging (for monitor/insults channels)')
      .setRequired(false)
      .addChannelTypes(ChannelType.GuildText)
  );

async function executeCommand(interaction: ChatInputCommandInteraction) {
  const guildId = interaction.guildId;
  if (!guildId) {
    await safeInteractionReply(interaction, { 
      content: 'This command can only be used in a server.', 
      flags: MessageFlags.Ephemeral 
    });
    return;
  }

  const action = interaction.options.getString('action', true);
  const role = interaction.options.getRole('role', false);
  const days = interaction.options.getInteger('days', false);
  const channel = interaction.options.getChannel('channel', false);

  try {
    switch (action) {
      case 'blamer-role':
        if (!role) {
          await safeInteractionReply(interaction, { 
            content: 'Please provide a role for the blamer role setting.', 
            flags: MessageFlags.Ephemeral 
          });
          return;
        }
        await handleBlamerRole(interaction, guildId, role);
        break;
      case 'frozen-role':
        if (!role) {
          await safeInteractionReply(interaction, { 
            content: 'Please provide a role for the frozen role setting.', 
            flags: MessageFlags.Ephemeral 
          });
          return;
        }
        await handleFrozenRole(interaction, guildId, role);
        break;
      case 'insulter-role':
        if (!role) {
          await safeInteractionReply(interaction, { 
            content: 'Please provide a role for the insulter role setting.', 
            flags: MessageFlags.Ephemeral 
          });
          return;
        }
        await handleInsulterRole(interaction, guildId, role);
        break;
      case 'insulter-days':
        if (days === null) {
          await safeInteractionReply(interaction, { 
            content: 'Please provide the number of days for the insulter role calculation.', 
            flags: MessageFlags.Ephemeral 
          });
          return;
        }
        await handleInsulterDays(interaction, guildId, days);
        break;
      case 'monitor-channel':
        if (!channel) {
          await safeInteractionReply(interaction, { 
            content: 'Please provide a channel for the monitor channel setting.', 
            flags: MessageFlags.Ephemeral 
          });
          return;
        }
        await handleMonitorChannel(interaction, guildId, channel);
        break;
      case 'insults-channel':
        if (!channel) {
          await safeInteractionReply(interaction, { 
            content: 'Please provide a channel for the insults channel setting.', 
            flags: MessageFlags.Ephemeral 
          });
          return;
        }
        await handleInsultsChannel(interaction, guildId, channel);
        break;
      case 'view':
        await handleViewConfig(interaction, guildId);
        break;
      default:
        await safeInteractionReply(interaction, { 
          content: 'Unknown action.', 
          flags: MessageFlags.Ephemeral 
        });
    }
  } catch (error) {
    console.error('Config command error:', error);
    await safeInteractionReply(interaction, { 
      content: 'An error occurred while updating configuration.', 
      flags: MessageFlags.Ephemeral 
    });
  }
}

async function handleBlamerRole(interaction: ChatInputCommandInteraction, guildId: string, role: any) {
  const isDisabled = role.name === 'none' || role.id === guildId; // @everyone role

  const setup = await prisma.setup.upsert({
    where: { guildId },
    update: { 
      blamerRoleId: isDisabled ? null : role.id,
      updatedAt: new Date()
    } as any,
    create: { 
      guildId, 
      blamerRoleId: isDisabled ? null : role.id 
    } as any
  });

  const status = isDisabled ? 'disabled' : `set to ${role.name}`;
  const embed = new EmbedBuilder()
    .setTitle('✅ Blamer Role Updated')
    .setDescription(`Blamer role ${status}. ${isDisabled ? 'All users can now use mutating commands.' : 'Only users with this role can use mutating commands.'}`)
    .setColor(0x00ff00)
    .setTimestamp();

  await safeInteractionReply(interaction, { embeds: [embed] });
  await logToMonitorChannel(interaction, `Blamer role ${status} by ${interaction.user.tag}`);
}

async function handleFrozenRole(interaction: ChatInputCommandInteraction, guildId: string, role: any) {
  const isDisabled = role.name === 'none' || role.id === guildId; // @everyone role

  const setup = await prisma.setup.upsert({
    where: { guildId },
    update: { 
      frozenRoleId: isDisabled ? null : role.id,
      updatedAt: new Date()
    } as any,
    create: { 
      guildId, 
      frozenRoleId: isDisabled ? null : role.id 
    } as any
  });

  const status = isDisabled ? 'disabled' : `set to ${role.name}`;
  const embed = new EmbedBuilder()
    .setTitle('✅ Frozen Role Updated')
    .setDescription(`Frozen role ${status}. ${isDisabled ? 'No users are blocked from using commands.' : 'Users with this role cannot use any bot commands.'}`)
    .setColor(0x00ff00)
    .setTimestamp();

  await safeInteractionReply(interaction, { embeds: [embed] });
  await logToMonitorChannel(interaction, `Frozen role ${status} by ${interaction.user.tag}`);
}

async function handleInsulterRole(interaction: ChatInputCommandInteraction, guildId: string, role: any) {
  const isDisabled = role.name === 'none' || role.id === guildId; // @everyone role

  const setup = await prisma.setup.upsert({
    where: { guildId },
    update: { 
      insulterRoleId: isDisabled ? null : role.id,
      updatedAt: new Date()
    } as any,
    create: { 
      guildId, 
      insulterRoleId: isDisabled ? null : role.id 
    } as any
  });

  const status = isDisabled ? 'disabled' : `set to ${role.name}`;
  const embed = new EmbedBuilder()
    .setTitle('✅ Insulter Role Updated')
    .setDescription(`Insulter role ${status}. ${isDisabled ? 'Auto-assignment is disabled.' : 'This role will be automatically assigned to the top insulter.'}`)
    .setColor(0x00ff00)
    .setTimestamp();

  await safeInteractionReply(interaction, { embeds: [embed] });
  await logToMonitorChannel(interaction, `Insulter role ${status} by ${interaction.user.tag}`);
}

async function handleInsulterDays(interaction: ChatInputCommandInteraction, guildId: string, days: number) {

  const setup = await prisma.setup.upsert({
    where: { guildId },
    update: { 
      insulterDays: days,
      updatedAt: new Date()
    } as any,
    create: { 
      guildId, 
      insulterDays: days 
    } as any
  });

  const timeWindow = days === 0 ? 'all-time' : `last ${days} days`;
  const embed = new EmbedBuilder()
    .setTitle('✅ Insulter Days Updated')
    .setDescription(`Insulter role calculation window set to ${timeWindow}.`)
    .setColor(0x00ff00)
    .setTimestamp();

  await safeInteractionReply(interaction, { embeds: [embed] });
  await logToMonitorChannel(interaction, `Insulter days set to ${days} by ${interaction.user.tag}`);
}

async function handleMonitorChannel(interaction: ChatInputCommandInteraction, guildId: string, channel: any) {
  const isDisabled = channel.name === 'none';

  const setup = await prisma.setup.upsert({
    where: { guildId },
    update: { 
      monitorChannelId: isDisabled ? null : channel.id,
      updatedAt: new Date()
    } as any,
    create: { 
      guildId, 
      monitorChannelId: isDisabled ? null : channel.id 
    } as any
  });

  const status = isDisabled ? 'disabled' : `set to ${channel.name}`;
  const embed = new EmbedBuilder()
    .setTitle('✅ Monitor Channel Updated')
    .setDescription(`Monitor channel ${status}. ${isDisabled ? 'System notifications are disabled.' : 'System notifications will be sent to this channel.'}`)
    .setColor(0x00ff00)
    .setTimestamp();

  await safeInteractionReply(interaction, { embeds: [embed] });
  await logToMonitorChannel(interaction, `Monitor channel ${status} by ${interaction.user.tag}`);
}

async function handleInsultsChannel(interaction: ChatInputCommandInteraction, guildId: string, channel: any) {
  const isDisabled = channel.name === 'none';

  const setup = await prisma.setup.upsert({
    where: { guildId },
    update: { 
      insultsChannelId: isDisabled ? null : channel.id,
      updatedAt: new Date()
    } as any,
    create: { 
      guildId, 
      insultsChannelId: isDisabled ? null : channel.id 
    } as any
  });

  const status = isDisabled ? 'disabled' : `set to ${channel.name}`;
  const embed = new EmbedBuilder()
    .setTitle('✅ Insults Channel Updated')
    .setDescription(`Insults channel ${status}. ${isDisabled ? 'Gameplay action logging is disabled.' : 'Gameplay actions will be logged to this channel.'}`)
    .setColor(0x00ff00)
    .setTimestamp();

  await safeInteractionReply(interaction, { embeds: [embed] });
  await logToMonitorChannel(interaction, `Insults channel ${status} by ${interaction.user.tag}`);
}

async function handleViewConfig(interaction: ChatInputCommandInteraction, guildId: string) {
  const setup = await prisma.setup.findUnique({
    where: { guildId }
  });

  const embed = new EmbedBuilder()
    .setTitle('⚙️ Server Configuration')
    .setColor(0x5865F2)
    .setTimestamp();

  if (!setup) {
    embed.setDescription('No configuration set. All features use default settings.');
  } else {
    const fields = [];

    // Blamer Role
    const blamerRole = (setup as any).blamerRoleId ? 
      `<@&${(setup as any).blamerRoleId}>` : 'Not set (all users can use mutating commands)';
    fields.push({ name: '🔨 Blamer Role', value: blamerRole, inline: true });

    // Frozen Role
    const frozenRole = (setup as any).frozenRoleId ? 
      `<@&${(setup as any).frozenRoleId}>` : 'Not set (no users blocked)';
    fields.push({ name: '❄️ Frozen Role', value: frozenRole, inline: true });

    // Insulter Role
    const insulterRole = (setup as any).insulterRoleId ? 
      `<@&${(setup as any).insulterRoleId}>` : 'Not set (auto-assignment disabled)';
    fields.push({ name: '👑 Insulter Role', value: insulterRole, inline: true });

    // Insulter Days
    const timeWindow = (setup as any).insulterDays === 0 ? 'All-time' : `Last ${(setup as any).insulterDays} days`;
    fields.push({ name: '📅 Insulter Time Window', value: timeWindow, inline: true });

    // Monitor Channel
    const monitorChannel = (setup as any).monitorChannelId ? 
      `<#${(setup as any).monitorChannelId}>` : 'Not set (system notifications disabled)';
    fields.push({ name: '📢 Monitor Channel', value: monitorChannel, inline: true });

    // Insults Channel
    const insultsChannel = (setup as any).insultsChannelId ? 
      `<#${(setup as any).insultsChannelId}>` : 'Not set (gameplay logging disabled)';
    fields.push({ name: '🎮 Insults Channel', value: insultsChannel, inline: true });

    embed.addFields(fields);
  }

  await safeInteractionReply(interaction, { embeds: [embed] });
}

async function logToMonitorChannel(interaction: ChatInputCommandInteraction, message: string) {
  try {
    const setup = await prisma.setup.findUnique({
      where: { guildId: interaction.guildId! }
    });

    if ((setup as any)?.monitorChannelId) {
      const channel = interaction.guild?.channels.cache.get((setup as any).monitorChannelId);
      if (channel?.isTextBased()) {
        const embed = new EmbedBuilder()
          .setTitle('🔧 Configuration Update')
          .setDescription(message)
          .setColor(0x5865F2)
          .setTimestamp();
        
        await channel.send({ embeds: [embed] });
      }
    }
  } catch (error) {
    console.error('Failed to log to monitor channel:', error);
  }
}

// Export with spam protection
export const execute = withSpamProtection(executeCommand);
