import { ActionRowBuilder, ButtonBuilder, ButtonInteraction, ButtonStyle, ChatInputCommandInteraction, EmbedBuilder, MessageFlags, SlashCommandBuilder } from 'discord.js';

export const data = new SlashCommandBuilder()
  .setName('help')
  .setDescription('Show help information and available commands');

export async function execute(interaction: ChatInputCommandInteraction) {
  const guildId = interaction.guildId;
  if (!guildId) {
    await interaction.reply({ content: 'This command can only be used in a server.', flags: MessageFlags.Ephemeral });
    return;
  }

  await showHelpMain(interaction);
}

export async function showHelpMain(interaction: ChatInputCommandInteraction | ButtonInteraction) {
  const embed = new EmbedBuilder()
  .setTitle('ℹ️ About Insults Bot')
  .setDescription('*Keep track of playful insults in your server and be aware of how often they happen*')
  .setColor(0x5865F2)
  .addFields(
    {
      name: '🎯 **Purpose**',
      value: 'Notice how often users insult each other and which insults appear most, helping everyone reduce them.',
      inline: false
    },
    {
      name: '💡 **Example**',
      value: '• `/blame @user "dog"` – Record an insult when someone called another player a dog in-game while angry.',
      inline: false
    },
    {
      name: '🔗 **Tip**',
      value: 'Click on the buttons below to explore all available commands and see what you can do!',
      inline: false
    }
  )
  .setFooter({ text: 'A fun way to stay aware and encourage respectful chats' })
  .setTimestamp();

  const row = new ActionRowBuilder<ButtonBuilder>()
    .addComponents(
      new ButtonBuilder()
        .setCustomId('help:recording')
        .setLabel('📝 Recording Commands')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('help:viewing')
        .setLabel('📊 Viewing Commands')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('help:management')
        .setLabel('⚙️ Management Commands')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('help:about')
        .setLabel('ℹ️ About')
        .setStyle(ButtonStyle.Secondary)
    );

  if (interaction.isButton()) {
    await interaction.update({ embeds: [embed], components: [row] });
  } else {
    await interaction.reply({ embeds: [embed], components: [row], flags: MessageFlags.Ephemeral });
  }
}

export async function showRecordingCommands(interaction: ButtonInteraction) {
  const embed = new EmbedBuilder()
    .setTitle('📝 Recording Commands')
    .setDescription('Commands for recording and managing insult entries')
    .setColor(0x00D26A)
    .addFields(
      {
        name: '`/blame @user insult [note]`',
        value: 'Record an insult for a specific user\n\n• **user**: The user being insulted (required)\n• **insult**: The insult word/phrase (required)\n• **note**: Optional context or comment',
        inline: false
      },
      {
        name: '`/form`',
        value: 'Two-step form to record an insult\n\n• Step 1: Select the target user\n• Step 2: Enter insult and optional note\n• More user-friendly interface',
        inline: false
      },
      {
        name: '`/unblame`',
        value: 'Remove a recent insult you added\n\n• Can only remove your own entries\n• Helps correct mistakes',
        inline: false
      }
    )
    .setFooter({ text: 'Use /blame for quick recording or /form for guided input' })
    .setTimestamp();

  const row = new ActionRowBuilder<ButtonBuilder>()
    .addComponents(
      new ButtonBuilder()
        .setCustomId('help:main')
        .setLabel('← Back to Main')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('help:viewing')
        .setLabel('📊 Viewing Commands')
        .setStyle(ButtonStyle.Secondary)
    );

  await interaction.update({ embeds: [embed], components: [row] });
}

export async function showViewingCommands(interaction: ButtonInteraction) {
  const embed = new EmbedBuilder()
    .setTitle('📊 Viewing Commands')
    .setDescription('Commands for viewing statistics and leaderboards')
    .setColor(0x00D26A)
    .addFields(
      {
        name: '`/rank`',
        value: 'Show insult leaderboard\n\n• Displays users ranked by total insults received\n• Includes pagination for large servers\n• Shows negative rankings (being insulted most is bad)',
        inline: false
      },
      {
        name: '`/insults`',
        value: 'Show top insults overview\n\n• Lists most used insults in the server\n• Clean, concise format\n• No arguments needed for overview',
        inline: false
      },
      {
        name: '`/insults <word>`',
        value: 'Show details for specific insult\n\n• View all instances of a particular insult\n• See who used it and when\n• Detailed breakdown with pagination',
        inline: false
      },
      {
        name: '`/history @user`',
        value: 'Show insult history for a user\n\n• View recent insults for specific person\n• Paginated results\n• Detailed information',
        inline: false
      },
      {
        name: '`/detail <id>`',
        value: 'Show details for specific insult entry\n\n• Get full information about a particular insult\n• Useful for moderation or investigation',
        inline: false
      }
    )
    .setFooter({ text: 'Use /rank to see who gets insulted most, /insults for popular insults' })
    .setTimestamp();

  const row = new ActionRowBuilder<ButtonBuilder>()
    .addComponents(
      new ButtonBuilder()
        .setCustomId('help:main')
        .setLabel('← Back to Main')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('help:recording')
        .setLabel('📝 Recording Commands')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('help:management')
        .setLabel('⚙️ Management Commands')
        .setStyle(ButtonStyle.Secondary)
    );

  await interaction.update({ embeds: [embed], components: [row] });
}

export async function showManagementCommands(interaction: ButtonInteraction) {
  const embed = new EmbedBuilder()
    .setTitle('⚙️ Management Commands')
    .setDescription('Commands for managing server features')
    .setColor(0x00D26A)
    .addFields(
      {
        name: '`/radar <enabled>`',
        value: 'Toggle automatic insult detection\n\n• **enabled**: true/false to enable or disable radar\n• Automatically scans messages for known insults\n• Requires Manage Server permission\n• Creates automatic blame records when insults are detected',
        inline: false
      }
    )
    .setFooter({ text: 'Radar automatically detects insults in messages and creates blame records' })
    .setTimestamp();

  const row = new ActionRowBuilder<ButtonBuilder>()
    .addComponents(
      new ButtonBuilder()
        .setCustomId('help:main')
        .setLabel('← Back to Main')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('help:recording')
        .setLabel('📝 Recording Commands')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('help:viewing')
        .setLabel('📊 Viewing Commands')
        .setStyle(ButtonStyle.Secondary)
    );

  await interaction.update({ embeds: [embed], components: [row] });
}

export async function showAbout(interaction: ButtonInteraction) {
  const embed = new EmbedBuilder()
    .setTitle('ℹ️ About Insults Bot')
    .setDescription('Learn more about the bot\'s purpose and features')
    .setColor(0x5865F2)
    .addFields(
      {
        name: '🎯 Mission',
        value: 'To promote self-awareness and reduce insulting behavior by making people conscious of how often they insult others.',
        inline: false
      },
      {
        name: '🔬 How It Works',
        value: '• Records insults with full metadata (who, when, what, notes)\n• Creates leaderboards showing who gets insulted most\n• Tracks popular insults and patterns\n• Provides insights to encourage better communication',
        inline: false
      },
      {
        name: '🛡️ Privacy & Safety',
        value: '• Only stores necessary data for functionality\n• All commands are ephemeral (only you can see responses)\n• No message content is stored beyond what you explicitly input\n• Data is scoped to your server only',
        inline: false
      },
      {
        name: '🔧 Technical Details',
        value: '```\n• Built with TypeScript and Discord.js\n• Uses Prisma ORM for data management\n• Supports pagination for large datasets\n• Real-time updates for live leaderboards\n```',
        inline: false
      },
      {
        name: '📈 Future Features',
        value: '• Optional consequences for top offenders\n• Advanced analytics and insights\n• Customizable settings per server\n• Integration with moderation tools',
        inline: false
      }
    )
    .setFooter({ text: 'Built to make Discord communities more aware and respectful' })
    .setTimestamp();

  const row = new ActionRowBuilder<ButtonBuilder>()
    .addComponents(
      new ButtonBuilder()
        .setCustomId('help:main')
        .setLabel('← Back to Main')
        .setStyle(ButtonStyle.Secondary)
    );

  await interaction.update({ embeds: [embed], components: [row] });
}

export async function handleButton(customId: string, interaction: ButtonInteraction) {
  if (!customId.startsWith('help:')) return;

  const action = customId.split(':')[1];

  switch (action) {
    case 'main':
      await showHelpMain(interaction);
      break;
    case 'recording':
      await showRecordingCommands(interaction);
      break;
    case 'viewing':
      await showViewingCommands(interaction);
      break;
    case 'management':
      await showManagementCommands(interaction);
      break;
    case 'about':
      await showAbout(interaction);
      break;
  }
}
