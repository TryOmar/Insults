import { ActionRowBuilder, ButtonBuilder, ButtonInteraction, ButtonStyle, ChatInputCommandInteraction, EmbedBuilder, MessageFlags, SlashCommandBuilder, TextChannel, userMention, ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { prisma } from '../database/client.js';
import { buildMessageLink } from '../utils/discordHelpers.js';
import * as insults from './insults.js';
import * as history from './history.js';
import * as liveRank from './live_rank.js';

const PAGE_SIZE = 10;

async function fetchLeaderboardData(guildId: string, page: number): Promise<{ userId: string; points: number; username: string }[]> {
  const rows = await prisma.insult.groupBy({
    by: ['userId'],
    where: { guildId },
    _count: { userId: true },
    orderBy: [{ _count: { userId: 'desc' } }, { userId: 'asc' }],
    skip: (page - 1) * PAGE_SIZE,
    take: PAGE_SIZE,
  });

  // Fetch usernames for all users
  const userIds = rows.map(row => row.userId);
  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, username: true }
  });

  const userMap = new Map(users.map(u => [u.id, u.username]));

  return rows.map(row => ({
    userId: row.userId,
    points: row._count.userId,
    username: userMap.get(row.userId) || 'Unknown User'
  }));
}

export const data = new SlashCommandBuilder()
  .setName('setup')
  .setDescription('Set up the insults bot in a channel with interactive leaderboard')
  .addChannelOption(option =>
    option.setName('channel')
      .setDescription('Channel to set up the bot in (defaults to current channel)')
      .setRequired(false)
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  const guildId = interaction.guildId;
  if (!guildId) {
    await interaction.reply({ content: 'This command can only be used in a server.', flags: MessageFlags.Ephemeral });
    return;
  }

  // Check if user has admin permissions
  if (!interaction.memberPermissions?.has('Administrator')) {
    await interaction.reply({ content: 'You need Administrator permissions to set up the bot.', flags: MessageFlags.Ephemeral });
    return;
  }

  const targetChannel = interaction.options.getChannel('channel') || interaction.channel;
  if (!targetChannel || !('isTextBased' in targetChannel) || !targetChannel.isTextBased()) {
    await interaction.reply({ content: 'Please specify a valid text channel.', flags: MessageFlags.Ephemeral });
    return;
  }

  // Check for existing setup and validate channel/message existence
  const existingSetup = await prisma.setup.findUnique({ where: { guildId } }).catch(() => null as any);

  if (existingSetup) {
    try {
      const channel = await interaction.client.channels.fetch(existingSetup.channelId).catch(() => null);
      if (!channel || !channel.isTextBased()) {
        // Channel missing: proceed to re-create setup in target channel
      } else {
        const msg = await (channel as TextChannel).messages.fetch(existingSetup.leaderboardMessageId).catch(() => null);
        if (msg) {
          const link = buildMessageLink(guildId, existingSetup.channelId, existingSetup.leaderboardMessageId);
          await interaction.reply({ content: `A setup already exists: ${link}`, flags: MessageFlags.Ephemeral });
          return;
        }
      }
    } catch {
      // Ignore and fall through to recreate
    }
  }

  try {
    // Send announcement embed
    const announcementEmbed = new EmbedBuilder()
      .setTitle('🤖 Insults Bot Setup')
      .setDescription('This channel will now track insults to promote self-awareness and healthier conversations in our community.')
      .setColor(0x5865F2)
      .addFields(
        {
          name: '🎯 Purpose',
          value: 'Help people notice how often they insult others and reduce insulting behavior through tracking and leaderboards.',
          inline: false
        },
        {
          name: '📊 Features',
          value: '• Track insults with metadata\n• View leaderboards and statistics\n• Analyze insult patterns\n• Promote self-awareness',
          inline: false
        }
      )
      .setFooter({ text: 'Use the buttons below to interact with the bot' })
      .setTimestamp();

    // Send help embed
    const helpEmbed = new EmbedBuilder()
      .setTitle('📚 How to Use')
      .setDescription('Quick guide to using the insults bot')
      .setColor(0x00D26A)
      .addFields(
        {
          name: '📝 Recording Insults',
          value: '• Use the **Blame** button below to record an insult\n• Or use `/blame @user insult [note]` command\n• Use `/form` for a guided experience',
          inline: false
        },
        {
          name: '📊 Viewing Data',
          value: '• **Insults** button shows most common insults\n• **History** button shows user insult history\n• Use `/rank` for user leaderboard\n• Use `/help` for full command list',
          inline: false
        },
        {
          name: '⚙️ Management',
          value: '• Use `/unblame` to remove recent entries\n• Use `/live_rank` for auto-updating leaderboards\n• All commands are ephemeral (only you see them)',
          inline: false
        }
      )
      .setTimestamp();

    // Get current rank leaderboard data (using same logic as /rank command)
    const leaderboardData = await fetchLeaderboardData(guildId, 1);
    let leaderboardEmbed: EmbedBuilder;
    
    if (leaderboardData.length === 0) {
      // No insults recorded yet - match /rank's empty state
      leaderboardEmbed = new EmbedBuilder()
        .setTitle('💀 Insults Leaderboard')
        .setDescription('No insults recorded yet.')
        .setColor(0xDC143C)
        .setFooter({ text: 'Click the buttons below to interact with the bot' })
        .setTimestamp();
    } else {
      // Format exactly like /rank command
      const rankList = leaderboardData.map((item, index) => {
        const rank = index + 1;
        let rankText = '';
        if (rank === 1) {
          rankText = '**1st Place:** 💀';
        } else if (rank === 2) {
          rankText = '**2nd Place:** 👎';
        } else if (rank === 3) {
          rankText = '**3rd Place:** 😢';
        } else {
          rankText = `**${rank}.**`;
        }
        const pointsText = item.points === 1 ? 'Point' : 'Points';
        return `${rankText} ${userMention(item.userId)} - ${item.points} ${pointsText}`;
      }).join('\n');

      leaderboardEmbed = new EmbedBuilder()
        .setTitle('💀 Insults Leaderboard')
        .setDescription(rankList)
        .setColor(0xDC143C)
        .setFooter({ text: 'Click the buttons below to interact with the bot' })
        .setTimestamp();
    }

    // Create buttons
    const buttonRow = new ActionRowBuilder<ButtonBuilder>()
      .addComponents(
        new ButtonBuilder()
          .setCustomId('setup:blame')
          .setLabel('📝 Blame')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId('setup:insults')
          .setLabel('📊 Insults')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId('setup:history')
          .setLabel('🕒 History')
          .setStyle(ButtonStyle.Primary)
      );

    // Send all embeds
    const announcementMessage = await (targetChannel as TextChannel).send({ embeds: [announcementEmbed] });
    const helpMessage = await (targetChannel as TextChannel).send({ embeds: [helpEmbed] });
    const leaderboardMessage = await (targetChannel as TextChannel).send({ embeds: [leaderboardEmbed], components: [buttonRow] });

    // Store or update setup in database
    if (existingSetup) {
      await prisma.setup.update({
        where: { guildId },
        data: { channelId: targetChannel.id, leaderboardMessageId: leaderboardMessage.id }
      }).catch(async () => {
        // If update fails (e.g., not found), fallback to create
        await prisma.setup.create({ data: { guildId, channelId: (targetChannel as TextChannel).id, leaderboardMessageId: leaderboardMessage.id } });
      });
    } else {
      await prisma.setup.create({ data: { guildId, channelId: (targetChannel as TextChannel).id, leaderboardMessageId: leaderboardMessage.id } });
    }

    // Send confirmation
    await interaction.reply({ 
      content: `✅ Setup complete! The bot is now ready to track insults in <#${targetChannel.id}>.`, 
      flags: MessageFlags.Ephemeral 
    });

  } catch (error) {
    console.error('Setup error:', error);
    try {
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ 
          content: 'An error occurred while setting up the bot. Please try again.', 
          flags: MessageFlags.Ephemeral 
        });
      } else if (interaction.deferred) {
        await interaction.editReply({ 
          content: 'An error occurred while setting up the bot. Please try again.'
        });
      }
    } catch (replyError) {
      console.error('Failed to send error response:', replyError);
    }
  }
}


export async function handleButton(customId: string, interaction: ButtonInteraction) {
  if (!customId.startsWith('setup:')) return;

  const action = customId.split(':')[1];

  try {
    switch (action) {
      case 'blame':
        // Step 1: Show user selection
        await handleFormButton(interaction);
        break;
      case 'insults':
        // Call insults.execute directly with proper interaction handling
        await handleInsultsButton(interaction);
        break;
      case 'history':
        // Call history.execute directly with proper interaction handling
        await handleHistoryButton(interaction);
        break;
      default:
        // Handle user selection buttons
        if (action.startsWith('blame_user_')) {
          const userId = action.replace('blame_user_', '');
          await showFormModal(interaction, userId);
        } else if (action === 'blame_manual') {
          await showFormModal(interaction, null);
        }
        break;
    }
  } catch (error) {
    console.error(`Error handling setup button ${action}:`, error);
    try {
      await interaction.reply({ 
        content: 'An error occurred while processing your request.', 
        flags: MessageFlags.Ephemeral 
      });
    } catch (replyError) {
      console.error('Failed to send error reply:', replyError);
    }
  }
}

async function handleFormButton(interaction: ButtonInteraction) {
  if (!interaction.guildId) {
    await interaction.reply({ content: 'Use this in a server.', flags: MessageFlags.Ephemeral });
    return;
  }

  try {
    // Step 1: Show user selection interface
    await showUserSelection(interaction);
  } catch (err) {
    console.error('[SETUP] User selection failed:', err);
    try {
      await interaction.reply({ content: 'Something went wrong while opening user selection.', flags: MessageFlags.Ephemeral });
    } catch {}
  }
}

async function showUserSelection(interaction: ButtonInteraction) {
  const guildId = interaction.guildId!;
  
  // Get recent users from the guild (users who have been insulted recently)
  const recentUsers = await prisma.insult.groupBy({
    by: ['userId'],
    where: { guildId },
    _count: { userId: true },
    orderBy: [{ _count: { userId: 'desc' } }],
    take: 10,
  });

  if (recentUsers.length === 0) {
    await interaction.reply({ 
      content: 'No users found to blame. Use the manual option below to enter a user ID.', 
      flags: MessageFlags.Ephemeral 
    });
    return;
  }

  // Get user details
  const userIds = recentUsers.map(u => u.userId);
  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, username: true }
  });

  const userMap = new Map(users.map(u => [u.id, u.username]));

  // Create embed
  const embed = new EmbedBuilder()
    .setTitle('📝 Select User to Blame')
    .setDescription('Choose a user from the recent list below, or use the manual option to enter a user ID.')
    .setColor(0x5865F2)
    .setTimestamp();

  // Create buttons for recent users (max 5 to fit in one row)
  const userButtons = recentUsers.slice(0, 5).map(user => {
    const username = userMap.get(user.userId) || 'Unknown User';
    return new ButtonBuilder()
      .setCustomId(`setup_blame_user_${user.userId}`)
      .setLabel(username.length > 20 ? username.substring(0, 17) + '...' : username)
      .setStyle(ButtonStyle.Secondary);
  });

  // Add manual option button
  const manualButton = new ButtonBuilder()
    .setCustomId('setup_blame_manual')
    .setLabel('📝 Manual Entry')
    .setStyle(ButtonStyle.Primary);

  const buttonRow = new ActionRowBuilder<ButtonBuilder>()
    .addComponents(...userButtons, manualButton);

  await interaction.reply({ 
    embeds: [embed], 
    components: [buttonRow], 
    flags: MessageFlags.Ephemeral 
  });
}

async function showFormModal(interaction: ButtonInteraction, targetUserId: string | null = null) {
  try {
    // Create the form modal
    const modal = new ModalBuilder()
      .setCustomId('setup_form_modal')
      .setTitle('Blame Form');

    let targetUserInput: TextInputBuilder;
    
    if (targetUserId) {
      // Pre-fill with selected user ID
      targetUserInput = new TextInputBuilder()
        .setCustomId('target_user')
        .setLabel('Target User ID')
        .setPlaceholder('Enter the user ID to blame')
        .setRequired(true)
        .setStyle(TextInputStyle.Short)
        .setValue(targetUserId);
    } else {
      // Manual entry
      targetUserInput = new TextInputBuilder()
        .setCustomId('target_user')
        .setLabel('Target User ID')
        .setPlaceholder('Enter the user ID to blame')
        .setRequired(true)
        .setStyle(TextInputStyle.Short);
    }

    const insult = new TextInputBuilder()
      .setCustomId('insult_text')
      .setLabel('Insult')
      .setPlaceholder('Enter the insult')
      .setRequired(true)
      .setStyle(TextInputStyle.Short);

    const note = new TextInputBuilder()
      .setCustomId('note_text')
      .setLabel('Optional Note')
      .setPlaceholder('Add extra context if needed')
      .setRequired(false)
      .setStyle(TextInputStyle.Paragraph);

    const row1 = new ActionRowBuilder<TextInputBuilder>().addComponents(targetUserInput);
    const row2 = new ActionRowBuilder<TextInputBuilder>().addComponents(insult);
    const row3 = new ActionRowBuilder<TextInputBuilder>().addComponents(note);
    modal.addComponents(row1, row2, row3);

    await interaction.showModal(modal);
  } catch (err) {
    console.error('[SETUP] Form modal failed:', err);
    try {
      await interaction.reply({ content: 'Something went wrong while opening the form.', flags: MessageFlags.Ephemeral });
    } catch {}
  }
}

async function handleInsultsButton(interaction: ButtonInteraction) {
  const guildId = interaction.guildId;
  if (!guildId) {
    await interaction.reply({ content: 'This command can only be used in a server.', flags: MessageFlags.Ephemeral });
    return;
  }

  // Show insults preview (same as /insults without word parameter)
  const scope = { mode: 'all' as const, guildId };
  await insults.respondWithInsults(interaction, scope, 1, true);
}

async function handleHistoryButton(interaction: ButtonInteraction) {
  const guildId = interaction.guildId;
  if (!guildId) {
    await interaction.reply({ content: 'This command can only be used in a server.', flags: MessageFlags.Ephemeral });
    return;
  }

  // Show general history (same as /history without user parameter)
  const scope = { guildId, userId: null };
  await history.respondWithHistory(interaction, scope, 1, true);
}

export async function handleModal(customId: string, interaction: any) {
  if (customId !== 'setup_form_modal') return;

  const guildId = interaction.guildId as string;

  try {
    const targetId = interaction.fields?.getTextInputValue('target_user')?.trim?.();
    const insult = interaction.fields?.getTextInputValue('insult_text')?.trim?.();
    const note = interaction.fields?.getTextInputValue('note_text')?.trim?.() || null;

    if (!insult) {
      await interaction.reply({ content: 'Insult is required.', flags: MessageFlags.Ephemeral });
      return;
    }
    if (!targetId) {
      await interaction.reply({ content: 'Please provide a valid user ID.', flags: MessageFlags.Ephemeral });
      return;
    }

    // Ensure users exist
    const targetUser = await interaction.client.users.fetch(targetId).catch(() => null);
    if (targetUser) {
      await prisma.user.upsert({ 
        where: { id: targetId }, 
        update: { username: targetUser.username }, 
        create: { id: targetId, username: targetUser.username } 
      });
    }
    await prisma.user.upsert({ 
      where: { id: interaction.user.id }, 
      update: { username: interaction.user.username }, 
      create: { id: interaction.user.id, username: interaction.user.username } 
    });

    await prisma.insult.create({
      data: {
        guildId,
        userId: targetId,
        blamerId: interaction.user.id,
        insult,
        note,
      }
    });

    await interaction.reply({ content: 'Blame recorded via form.', flags: MessageFlags.Ephemeral });
  } catch (err) {
    console.error('[SETUP] Modal submission failed:', err);
    try { 
      await interaction.reply({ content: 'Could not save your form submission.', flags: MessageFlags.Ephemeral }); 
    } catch {}
  }

  // Update live rank if present
  if (guildId) {
    try {
      await liveRank.refreshLiveRank(guildId, async (channelId: string, messageId: string) => {
        try {
          const channel = await interaction.client.channels.fetch(channelId);
          if (!channel || !channel.isTextBased()) return null;
          const msg = await (channel as any).messages.fetch(messageId);
          return msg ?? null;
        } catch {
          return null;
        }
      });
    } catch (error) {
      console.error('Error updating live rank:', error);
    }
  }
}

export async function updateLeaderboard(guildId: string, client: any) {
  try {
    // TODO: Uncomment when Prisma client is regenerated
    // const setup = await prisma.setup.findFirst({
    //   where: { guildId }
    // });

    // if (!setup) return;

    // const channel = await client.channels.fetch(setup.channelId) as TextChannel;
    // if (!channel) return;

    // const message = await channel.messages.fetch(setup.leaderboardMessageId);
    // if (!message) return;

    // Get current rank leaderboard data (using same logic as /rank command)
    // const leaderboardData = await fetchLeaderboardData(guildId, 1);
    // let leaderboardEmbed: EmbedBuilder;
    
    // if (leaderboardData.length === 0) {
    //   // No insults recorded yet - match /rank's empty state
    //   leaderboardEmbed = new EmbedBuilder()
    //     .setTitle('💀 Insults Leaderboard')
    //     .setDescription('No insults recorded yet.')
    //     .setColor(0xDC143C)
    //     .setFooter({ text: 'Click the buttons below to interact with the bot' })
    //     .setTimestamp();
    // } else {
    //   // Format exactly like /rank command
    //   const rankList = leaderboardData.map((item, index) => {
    //     const rank = index + 1;
    //     let rankText = '';
    //     if (rank === 1) {
    //       rankText = '**1st Place:** 💀';
    //     } else if (rank === 2) {
    //       rankText = '**2nd Place:** 👎';
    //     } else if (rank === 3) {
    //       rankText = '**3rd Place:** 😢';
    //     } else {
    //       rankText = `**${rank}.**`;
    //     }
    //     const pointsText = item.points === 1 ? 'Point' : 'Points';
    //     return `${rankText} ${userMention(item.userId)} - ${item.points} ${pointsText}`;
    //   }).join('\n');

    //   leaderboardEmbed = new EmbedBuilder()
    //     .setTitle('💀 Insults Leaderboard')
    //     .setDescription(rankList)
    //     .setColor(0xDC143C)
    //     .setFooter({ text: 'Click the buttons below to interact with the bot' })
    //     .setTimestamp();
    // }

    // // Create buttons
    // const buttonRow = new ActionRowBuilder<ButtonBuilder>()
    //   .addComponents(
    //     new ButtonBuilder()
    //       .setCustomId('setup:blame')
    //       .setLabel('📝 Blame')
    //       .setStyle(ButtonStyle.Primary),
    //     new ButtonBuilder()
    //       .setCustomId('setup:insults')
    //       .setLabel('📊 Insults')
    //       .setStyle(ButtonStyle.Primary),
    //     new ButtonBuilder()
    //       .setCustomId('setup:history')
    //       .setLabel('🕒 History')
    //       .setStyle(ButtonStyle.Primary)
    //   );

    // await message.edit({ embeds: [leaderboardEmbed], components: [buttonRow] });
  } catch (error) {
    console.error('Error updating leaderboard:', error);
  }
}
