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
import { setupCache } from '../utils/setupCache.js';

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
        { name: 'View Configuration', value: 'view' },
        { name: 'Set Monitor Channel', value: 'monitor-channel' },
        { name: 'Set Insults Channel', value: 'insults-channel' },
        { name: 'Set Blamer Role', value: 'blamer-role' },
        { name: 'Set Frozen Role', value: 'frozen-role' },
        { name: 'Set Insulter Role', value: 'insulter-role' },
        { name: 'Set Insulter Days', value: 'insulter-days' },
        { name: 'Set Radar Mode', value: 'radar-mode' }
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
  )
  .addStringOption(option =>
    option
      .setName('radar_mode')
      .setDescription('Radar mode to set (for radar-mode action)')
      .setRequired(false)
      .addChoices(
        { name: 'Off - Radar disabled', value: 'off' },
        { name: 'Blame - Only blames users', value: 'blame' },
        { name: 'Delete - Only deletes messages', value: 'delete' },
        { name: 'Both - Blames and deletes together', value: 'both' }
      )
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

  // Defer the interaction to show "thinking" state
  try {
    await interaction.deferReply();
  } catch (error) {
    // Ignore if already acknowledged
    console.warn('Failed to defer config interaction:', error);
  }

  const action = interaction.options.getString('action', true);
  const role = interaction.options.getRole('role', false);
  const days = interaction.options.getInteger('days', false);
  const channel = interaction.options.getChannel('channel', false);
  const radarMode = interaction.options.getString('radar_mode', false);

  try {
    switch (action) {
      case 'blamer-role':
        await handleBlamerRole(interaction, guildId, role);
        break;
      case 'frozen-role':
        await handleFrozenRole(interaction, guildId, role);
        break;
      case 'insulter-role':
        await handleInsulterRole(interaction, guildId, role);
        break;
      case 'insulter-days':
        if (days === null) {
          await interaction.editReply({ 
            content: 'Please provide the number of days for the insulter role calculation.'
          });
          return;
        }
        await handleInsulterDays(interaction, guildId, days);
        break;
      case 'monitor-channel':
        await handleMonitorChannel(interaction, guildId, channel);
        break;
      case 'insults-channel':
        await handleInsultsChannel(interaction, guildId, channel);
        break;
      case 'radar-mode':
        if (radarMode === null) {
          await interaction.editReply({ 
            content: 'Please select a radar mode.'
          });
          return;
        }
        await handleRadarMode(interaction, guildId, radarMode);
        break;
      case 'view':
        await handleViewConfig(interaction, guildId);
        break;
      default:
        await interaction.editReply({ 
          content: 'Unknown action.'
        });
    }
  } catch (error) {
    console.error('Config command error:', error);
    await interaction.editReply({ 
      content: 'An error occurred while updating configuration.'
    });
  }
}

async function handleBlamerRole(interaction: ChatInputCommandInteraction, guildId: string, role: any) {
  const everyoneId = interaction.guild?.roles.everyone.id;
  const isDisabled = !role || (everyoneId && role.id === everyoneId);

  const setup = await prisma.setup.upsert({
    where: { guildId },
    update: { 
      blamerRoleId: isDisabled ? null : role.id,
      updatedAt: new Date()
    },
    create: { 
      guildId, 
      blamerRoleId: isDisabled ? null : role.id 
    }
  });

  // Update cache with the new setup data
  setupCache.updateCache(guildId, {
    guildId: setup.guildId,
    blamerRoleId: setup.blamerRoleId,
    frozenRoleId: setup.frozenRoleId,
    insultsChannelId: setup.insultsChannelId,
    monitorChannelId: setup.monitorChannelId,
    insulterRoleId: setup.insulterRoleId,
    insulterDays: setup.insulterDays,
    radarMode: setup.radarMode
  });

  const status = isDisabled ? 'disabled' : `set to ${role?.name || 'Unknown'}`;
  const embed = new EmbedBuilder()
    .setTitle('✅ Blamer Role Updated')
    .setDescription(`Blamer role ${status}. ${isDisabled ? 'All users can now use mutating commands.' : 'Only users with this role can use mutating commands.'}`)
    .setColor(0x00ff00)
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
  await logToMonitorChannel(interaction, `Blamer role ${status} by ${interaction.user.tag}`);
}

async function handleFrozenRole(interaction: ChatInputCommandInteraction, guildId: string, role: any) {
  const everyoneId = interaction.guild?.roles.everyone.id;
  const isDisabled = !role || (everyoneId && role.id === everyoneId);

  const setup = await prisma.setup.upsert({
    where: { guildId },
    update: { 
      frozenRoleId: isDisabled ? null : role.id,
      updatedAt: new Date()
    },
    create: { 
      guildId, 
      frozenRoleId: isDisabled ? null : role.id 
    }
  });

  // Update cache with the new setup data
  setupCache.updateCache(guildId, {
    guildId: setup.guildId,
    blamerRoleId: setup.blamerRoleId,
    frozenRoleId: setup.frozenRoleId,
    insultsChannelId: setup.insultsChannelId,
    monitorChannelId: setup.monitorChannelId,
    insulterRoleId: setup.insulterRoleId,
    insulterDays: setup.insulterDays,
    radarMode: setup.radarMode
  });

  const status = isDisabled ? 'disabled' : `set to ${role?.name || 'Unknown'}`;
  const embed = new EmbedBuilder()
    .setTitle('✅ Frozen Role Updated')
    .setDescription(`Frozen role ${status}. ${isDisabled ? 'No users are blocked from using commands.' : 'Users with this role cannot use any bot commands.'}`)
    .setColor(0x00ff00)
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
  await logToMonitorChannel(interaction, `Frozen role ${status} by ${interaction.user.tag}`);
}

async function handleInsulterRole(interaction: ChatInputCommandInteraction, guildId: string, role: any) {
  const everyoneId = interaction.guild?.roles.everyone.id;
  const isDisabled = !role || (everyoneId && role.id === everyoneId);

  const setup = await prisma.setup.upsert({
    where: { guildId },
    update: { 
      insulterRoleId: isDisabled ? null : role.id,
      updatedAt: new Date()
    },
    create: { 
      guildId, 
      insulterRoleId: isDisabled ? null : role.id 
    }
  });

  // Update cache with the new setup data
  setupCache.updateCache(guildId, {
    guildId: setup.guildId,
    blamerRoleId: setup.blamerRoleId,
    frozenRoleId: setup.frozenRoleId,
    insultsChannelId: setup.insultsChannelId,
    monitorChannelId: setup.monitorChannelId,
    insulterRoleId: setup.insulterRoleId,
    insulterDays: setup.insulterDays,
    radarMode: setup.radarMode
  });

  const status = isDisabled ? 'disabled' : `set to ${role?.name || 'Unknown'}`;
  const embed = new EmbedBuilder()
    .setTitle('✅ Insulter Role Updated')
    .setDescription(`Insulter role ${status}. ${isDisabled ? 'Auto-assignment is disabled.' : 'This role will be automatically assigned to the top insulter.'}`)
    .setColor(0x00ff00)
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
  await logToMonitorChannel(interaction, `Insulter role ${status} by ${interaction.user.tag}`);
}

async function handleInsulterDays(interaction: ChatInputCommandInteraction, guildId: string, days: number) {

  const setup = await prisma.setup.upsert({
    where: { guildId },
    update: { 
      insulterDays: days,
      updatedAt: new Date()
    },
    create: { 
      guildId, 
      insulterDays: days 
    }
  });

  // Update cache with the new setup data
  setupCache.updateCache(guildId, {
    guildId: setup.guildId,
    blamerRoleId: setup.blamerRoleId,
    frozenRoleId: setup.frozenRoleId,
    insultsChannelId: setup.insultsChannelId,
    monitorChannelId: setup.monitorChannelId,
    insulterRoleId: setup.insulterRoleId,
    insulterDays: setup.insulterDays,
    radarMode: setup.radarMode
  });

  const timeWindow = days === 0 ? 'all-time' : `last ${days} days`;
  const embed = new EmbedBuilder()
    .setTitle('✅ Insulter Days Updated')
    .setDescription(`Insulter role calculation window set to ${timeWindow}.`)
    .setColor(0x00ff00)
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
  await logToMonitorChannel(interaction, `Insulter days set to ${days} by ${interaction.user.tag}`);
}

async function handleMonitorChannel(interaction: ChatInputCommandInteraction, guildId: string, channel: any) {
  const isDisabled = !channel;

  const setup = await prisma.setup.upsert({
    where: { guildId },
    update: { 
      monitorChannelId: isDisabled ? null : channel.id,
      updatedAt: new Date()
    },
    create: { 
      guildId, 
      monitorChannelId: isDisabled ? null : channel.id 
    }
  });

  // Update cache with the new setup data
  setupCache.updateCache(guildId, {
    guildId: setup.guildId,
    blamerRoleId: setup.blamerRoleId,
    frozenRoleId: setup.frozenRoleId,
    insultsChannelId: setup.insultsChannelId,
    monitorChannelId: setup.monitorChannelId,
    insulterRoleId: setup.insulterRoleId,
    insulterDays: setup.insulterDays,
    radarMode: setup.radarMode
  });

  const status = isDisabled ? 'disabled' : `set to ${channel?.name || 'Unknown'}`;
  const embed = new EmbedBuilder()
    .setTitle('✅ Monitor Channel Updated')
    .setDescription(`Monitor channel ${status}. ${isDisabled ? 'System notifications are disabled.' : 'System notifications will be sent to this channel.'}`)
    .setColor(0x00ff00)
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
  await logToMonitorChannel(interaction, `Monitor channel ${status} by ${interaction.user.tag}`);
}

async function handleInsultsChannel(interaction: ChatInputCommandInteraction, guildId: string, channel: any) {
  const isDisabled = !channel;

  const setup = await prisma.setup.upsert({
    where: { guildId },
    update: { 
      insultsChannelId: isDisabled ? null : channel.id,
      updatedAt: new Date()
    },
    create: { 
      guildId, 
      insultsChannelId: isDisabled ? null : channel.id 
    }
  });

  // Update cache with the new setup data
  setupCache.updateCache(guildId, {
    guildId: setup.guildId,
    blamerRoleId: setup.blamerRoleId,
    frozenRoleId: setup.frozenRoleId,
    insultsChannelId: setup.insultsChannelId,
    monitorChannelId: setup.monitorChannelId,
    insulterRoleId: setup.insulterRoleId,
    insulterDays: setup.insulterDays,
    radarMode: setup.radarMode
  });

  const status = isDisabled ? 'disabled' : `set to ${channel?.name || 'Unknown'}`;
  const embed = new EmbedBuilder()
    .setTitle('✅ Insults Channel Updated')
    .setDescription(`Insults channel ${status}. ${isDisabled ? 'Gameplay action logging is disabled.' : 'Gameplay actions will be logged to this channel.'}`)
    .setColor(0x00ff00)
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
  await logToMonitorChannel(interaction, `Insults channel ${status} by ${interaction.user.tag}`);
}

async function handleViewConfig(interaction: ChatInputCommandInteraction, guildId: string) {
  const setup = await setupCache.getSetup(guildId);

  console.log('Config view - Guild ID:', guildId);
  console.log('Config view - Setup data:', setup);

  const embed = new EmbedBuilder()
    .setTitle('⚙️ Server Configuration')
    .setColor(0x5865F2)
    .setTimestamp();

  if (!setup) {
    embed.setDescription('No configuration set. All features use default settings.');
  } else {
    // Blamer Role
    const blamerRole = (setup as any).blamerRoleId ? 
      `<@&${(setup as any).blamerRoleId}>` : 'Not set (all users can use mutating commands)';
    console.log('Blamer role ID:', (setup as any).blamerRoleId, 'Display:', blamerRole);
    embed.addFields({ name: '🔨 Blamer Role', value: blamerRole, inline: true });

    // Frozen Role
    const frozenRole = (setup as any).frozenRoleId ? 
      `<@&${(setup as any).frozenRoleId}>` : 'Not set (no users blocked)';
    console.log('Frozen role ID:', (setup as any).frozenRoleId, 'Display:', frozenRole);
    embed.addFields({ name: '❄️ Frozen Role', value: frozenRole, inline: true });

    // Insulter Role
    const insulterRole = (setup as any).insulterRoleId ? 
      `<@&${(setup as any).insulterRoleId}>` : 'Not set (auto-assignment disabled)';
    console.log('Insulter role ID:', (setup as any).insulterRoleId, 'Display:', insulterRole);
    embed.addFields({ name: '👑 Insulter Role', value: insulterRole, inline: true });

    // Insulter Days
    const insulterDays = (setup as any).insulterDays;
    const timeWindow = insulterDays === 0 ? 'All-time' : `Last ${insulterDays} days`;
    console.log('Insulter days:', insulterDays, 'Display:', timeWindow);
    embed.addFields({ name: '📅 Insulter Time Window', value: timeWindow, inline: true });

    // Monitor Channel
    const monitorChannelId = (setup as any).monitorChannelId;
    const monitorChannel = monitorChannelId ? 
      `<#${monitorChannelId}>` : 'Not set (system notifications disabled)';
    console.log('Monitor channel ID:', monitorChannelId, 'Display:', monitorChannel);
    embed.addFields({ name: '📢 Monitor Channel', value: monitorChannel, inline: true });

    // Insults Channel
    const insultsChannelId = (setup as any).insultsChannelId;
    const insultsChannel = insultsChannelId ? 
      `<#${insultsChannelId}>` : 'Not set (gameplay logging disabled)';
    console.log('Insults channel ID:', insultsChannelId, 'Display:', insultsChannel);
    embed.addFields({ name: '🎮 Insults Channel', value: insultsChannel, inline: true });

    // Radar Mode
    const radarMode = (setup as any).radarMode || 'off';
    const radarDescriptions = {
      'off': 'Disabled',
      'blame': 'Blame mode (only blames users)',
      'delete': 'Delete mode (only deletes messages)',
      'both': 'Both mode (blames and deletes together)'
    };
    const radarDisplay = radarDescriptions[radarMode as keyof typeof radarDescriptions] || 'Disabled';
    console.log('Radar mode:', radarMode, 'Display:', radarDisplay);
    embed.addFields({ name: '📡 Radar Mode', value: radarDisplay, inline: true });
  }

  await interaction.editReply({ embeds: [embed] });
}

async function handleRadarMode(interaction: ChatInputCommandInteraction, guildId: string, radarMode: string) {
  const setup = await prisma.setup.upsert({
    where: { guildId },
    update: { 
      radarMode: radarMode,
      updatedAt: new Date()
    } as any, // Type assertion until Prisma client is regenerated
    create: { 
      guildId, 
      radarMode: radarMode 
    } as any // Type assertion until Prisma client is regenerated
  });

  // Update cache with the new setup data
  setupCache.updateCache(guildId, {
    guildId: setup.guildId,
    blamerRoleId: setup.blamerRoleId,
    frozenRoleId: setup.frozenRoleId,
    insultsChannelId: setup.insultsChannelId,
    monitorChannelId: setup.monitorChannelId,
    insulterRoleId: setup.insulterRoleId,
    insulterDays: setup.insulterDays,
    radarMode: setup.radarMode
  });

  const modeDescriptions = {
    'off': 'disabled',
    'blame': 'set to blame mode (only blames users)',
    'delete': 'set to delete mode (only deletes messages)',
    'both': 'set to both mode (blames and deletes together)'
  };

  const status = modeDescriptions[radarMode as keyof typeof modeDescriptions] || 'disabled';
  const embed = new EmbedBuilder()
    .setTitle('✅ Radar Mode Updated')
    .setDescription(`Radar is now ${status} for this server.`)
    .setColor(0x00ff00)
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
  await logToMonitorChannel(interaction, `Radar ${status} by ${interaction.user.tag}`);
}

async function logToMonitorChannel(interaction: ChatInputCommandInteraction, message: string) {
  try {
    const setup = await setupCache.getSetup(interaction.guildId!);

    if (setup?.monitorChannelId) {
      const channel = interaction.guild?.channels.cache.get(setup.monitorChannelId);
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
