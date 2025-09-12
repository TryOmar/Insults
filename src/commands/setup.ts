import { ActionRowBuilder, ButtonBuilder, ButtonInteraction, ButtonStyle, ChatInputCommandInteraction, EmbedBuilder, MessageFlags, SlashCommandBuilder, TextChannel, userMention } from 'discord.js';
import { prisma } from '../database/client.js';
import * as form from './form.js';
import * as insults from './insults.js';
import * as history from './history.js';

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

  // Check for existing setup
  // TODO: Uncomment when Prisma client is regenerated
  // const existingSetup = await prisma.setup.findFirst({
  //   where: { guildId }
  // });

  // if (existingSetup) {
  //   await interaction.reply({ 
  //     content: `A setup already exists in <#${existingSetup.channelId}>. Please remove the old setup before creating a new one.`, 
  //     flags: MessageFlags.Ephemeral 
  //   });
  //   return;
  // }

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

    // Store setup in database
    // TODO: Uncomment when Prisma client is regenerated
    // await prisma.setup.create({
    //   data: {
    //     guildId,
    //     channelId: targetChannel.id,
    //     leaderboardMessageId: leaderboardMessage.id,
    //     createdAt: new Date()
    //   }
    // });

    // Send confirmation
    await interaction.reply({ 
      content: `✅ Setup complete! The bot is now ready to track insults in <#${targetChannel.id}>.`, 
      flags: MessageFlags.Ephemeral 
    });

  } catch (error) {
    console.error('Setup error:', error);
    await interaction.reply({ 
      content: 'An error occurred while setting up the bot. Please try again.', 
      flags: MessageFlags.Ephemeral 
    });
  }
}


export async function handleButton(customId: string, interaction: ButtonInteraction) {
  if (!customId.startsWith('setup:')) return;

  const action = customId.split(':')[1];

  switch (action) {
    case 'blame':
      // Trigger the form command
      await form.execute(interaction as any);
      break;
    case 'insults':
      // Trigger the insults command
      await insults.execute(interaction as any);
      break;
    case 'history':
      // Trigger the history command
      await history.execute(interaction as any);
      break;
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
