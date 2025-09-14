import { ChatInputCommandInteraction, EmbedBuilder, MessageFlags, SlashCommandBuilder, ActionRowBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, ComponentType, StringSelectMenuInteraction } from 'discord.js';
import { withSpamProtection } from '../utils/commandWrapper.js';
import { BASE_DELAY, VIOLATION_WINDOW, MAX_VIOLATIONS, MAX_LEVEL, LEVEL_RESET_TIME, LEVEL_DECAY_INTERVAL } from '../utils/cooldown.js';

// Track help message timeouts to remove dropdowns after 5 minutes
const helpMessageTimeouts = new Map<string, NodeJS.Timeout>();

export const data = new SlashCommandBuilder()
  .setName('help')
  .setDescription('Show help information and available commands');

// Command information with detailed descriptions and user stories
const COMMAND_INFO = {
  blame: {
    name: 'blame',
    description: 'Record an insult against a user',
    usage: '`/blame @user insult [note]`',
    userStory: '**User Story:** As a server member, I want to record when someone insults another person so we can track patterns and have accountability.',
    details: '**Parameters:**\n• `user` (required) - The user being insulted\n• `insult` (required) - The insult phrase (up to 3 words, max 20 chars per word)\n• `note` (optional) - Additional context (≤500 chars)\n\n**Features:**\n• Automatically sends DM to the insulted user\n• Adds 👍👎 reactions for community feedback\n• Validates input and prevents bot targeting'
  },
  unblame: {
    name: 'unblame',
    description: 'Delete a blame record by ID',
    usage: '`/unblame <id>`',
    userStory: '**User Story:** As a user, I want to remove blame records I created (or admins want to remove any) when they were mistakes or inappropriate.',
    details: '**Parameters:**\n• `id` (required) - The blame record ID to delete (supports multiple IDs)\n\n**Permissions:**\n• Anyone can unblame others\n• You cannot unblame yourself if you are the target but not the blamer\n• Admins can delete any record\n\n**Features:**\n• Moves deleted records to archive for audit trail\n• Supports multiple IDs in one command (separated by spaces or commas)\n• Shows detailed summary of what was deleted\n• Paginated results with navigation buttons\n• Handles already archived records gracefully'
  },
  rank: {
    name: 'rank',
    description: 'Show the insult leaderboard',
    usage: '`/rank [days]`',
    userStory: '**User Story:** As a server member, I want to see who has been insulted the most so we can understand the social dynamics and patterns.',
    details: '**Parameters:**\n• `days` (optional) - Number of calendar days to look back (0-3650)\n\n**Time Periods:**\n• `/rank` or `/rank days:0` - All-time leaderboard\n• `/rank days:1` - Today only (from midnight today → now)\n• `/rank days:7` - Last 7 full calendar days (including today)\n• `/rank days:30` - Last 30 full calendar days (including today)\n\n**Features:**\n• Shows users ranked by total insults received\n• Displays points and usernames with time period in title\n• Paginated for large servers\n• Includes quick blame button for easy recording\n• Ties broken by earliest first insult\n• **Calendar Days:** Uses full calendar days, not rolling 24-hour periods\n• **Default:** Shows all-time data if no arguments provided'
  },
  history: {
    name: 'history',
    description: 'Show insult history for a user or the whole server',
    usage: '`/history [@user]`',
    userStory: '**User Story:** As a user, I want to see the history of insults either for a specific person or the entire server to understand patterns and context.',
    details: '**Parameters:**\n• `user` (optional) - Filter by specific user\n\n**Features:**\n• Shows detailed table with IDs, users, and insults\n• Displays statistics (total blames, users, insults)\n• Shows insult frequency breakdown\n• Paginated for large datasets\n• Use `/detail <id>` for more info on specific records'
  },
  insults: {
    name: 'insults',
    description: 'Show insult statistics overall or for a specific word',
    usage: '`/insults [word]`',
    userStory: '**User Story:** As a server member, I want to see what insults are most common and analyze specific insult patterns to understand server culture.',
    details: '**Parameters:**\n• `word` (optional) - Specific insult phrase to analyze (up to 3 words, max 20 chars per word)\n\n**Features:**\n• **General view:** Shows all insults ranked by frequency\n• **Word view:** Shows all instances of a specific insult\n• Displays first/last/top users for each insult\n• Paginated for large datasets\n• Case-insensitive matching'
  },
  detail: {
    name: 'detail',
    description: 'Show full details for a blame record by ID',
    usage: '`/detail <id>`',
    userStory: '**User Story:** As a user, I want to see complete details of a specific blame record including who blamed whom, when, and any notes for full context.',
    details: '**Parameters:**\n• `id` (required) - The blame record ID\n\n**Features:**\n• Shows complete record information\n• Works with both active and archived records\n• Displays all metadata (user, blamer, time, note)\n• Adds reactions for community feedback\n• Handles archived records with special formatting'
  },
  radar: {
    name: 'radar',
    description: 'Toggle automatic insult detection on/off',
    usage: '`/radar <enabled>`',
    userStory: '**User Story:** As a server admin, I want to enable/disable automatic scanning of messages for insults so the bot can help monitor the server automatically.',
    details: '**Parameters:**\n• `enabled` (required) - true/false to enable/disable\n\n**Permissions:**\n• Requires "Manage Server" permission\n\n**Features:**\n• Automatically scans messages for insult patterns\n• Creates blame records when insults are detected\n• Can be toggled on/off per server\n• Ephemeral response for privacy'
  },
  archive: {
    name: 'archive',
    description: 'Show archived (unblamed) records',
    usage: '`/archive [@user] [role]`',
    userStory: '**User Story:** As a moderator, I want to see what blame records have been deleted and by whom for audit purposes and to understand moderation patterns.',
    details: '**Parameters:**\n• `user` (optional) - Filter by user involved\n• `role` (optional) - Filter by user role (insulted/blamer/unblamer)\n\n**Features:**\n• Shows deleted blame records\n• Displays who deleted each record\n• Filterable by user and their role\n• Paginated for large archives\n• Shows original insult IDs for reference'
  },
  revert: {
    name: 'revert',
    description: 'Restore archived blames back into active records',
    usage: '`/revert <id>`',
    userStory: '**User Story:** As a user or admin, I want to restore accidentally deleted blame records back to active status when they were removed by mistake.',
    details: '**Parameters:**\n• `id` (required) - The archived blame ID to restore\n\n**Permissions:**\n• Original blamer can restore their records\n• Admins can restore any record\n\n**Features:**\n• Creates new active record with new ID\n• Removes from archive after restoration\n• Shows mapping of original → new ID\n• Detailed summary of restoration process'
  },
  clear: {
    name: 'clear',
    description: 'Clear DM messages sent by the bot to you',
    usage: '`/clear [count]`',
    userStory: '**User Story:** As a user, I want to clean up my DM conversation with the bot by removing a specific number of messages the bot has sent to me.',
    details: '**Parameters:**\n• `count` (optional) - Number of bot messages to clear (default: 50, max: 100)\n\n**Usage:**\n• Can only be used in private messages (DMs) with the bot\n• Clears the most recent bot messages first\n• Handles message age limits gracefully\n• Shows count of successfully deleted messages\n\n**Features:**\n• Customizable message count (1-100)\n• Individual deletion for reliability\n• Error handling for permission issues\n• Confirmation of deletion count\n• Smart fetching to ensure enough bot messages are found'
  },
  config: {
    name: 'config',
    description: 'Configure bot settings for this server',
    usage: '`/config action:<choice> [role/channel/days]`',
    userStory: '**User Story:** As a server administrator, I want to configure role-based permissions and logging channels so I can control who can use the bot and where notifications are sent.',
    details: '**Actions:**\n• `Set Blamer Role` + @role - Set role for mutating commands\n• `Set Frozen Role` + @role - Set role that blocks all commands\n• `Set Insulter Role` + @role - Set auto-assigned top insulter role\n• `Set Insulter Days` + days - Set time window for insulter calculation\n• `Set Monitor Channel` + #channel - Set system notifications channel\n• `Set Insults Channel` + #channel - Set gameplay action logging channel\n• `View Configuration` - View current configuration\n\n**Permissions:**\n• Requires "Manage Server" permission\n\n**Features:**\n• Role-based access control for commands\n• Automatic top insulter role assignment\n• Configurable logging channels\n• Time-based insulter calculations\n• Easy configuration management'
  },
  'anti-spam': {
    name: 'anti-spam',
    description: 'Anti-spam system information (NOT A COMMAND)',
    usage: 'System Information',
    userStory: '**User Story:** As a user, I want to understand how the anti-spam system works so I can use the bot effectively without getting blocked.',
    details: `**System Configuration:**\n• \`BASE_DELAY = 3s\` - Wait after each command\n• \`VIOLATION_WINDOW = 10s\` - Time to check for spam\n• \`MAX_VIOLATIONS = 3\` - Commands in window → violation\n• \`MAX_LEVEL = 10\` - Max escalation level\n• \`LEVEL_RESET_TIME = 5m\` - Inactivity before level drops\n• \`LEVEL_DECAY_INTERVAL = 1m\` - Time between each level drop\n\n**How Anti-Spam Works:**\nA guardian watches your commands:\n\n**1.** Send a command → wait \`BASE_DELAY\`\n**2.** Send \`MAX_VIOLATIONS\` too fast within \`VIOLATION_WINDOW\` → level ↑\n**3.** Each level doubles your wait up to \`MAX_LEVEL\` → temporary block\n**4.** Stay quiet for \`LEVEL_RESET_TIME\` → levels start dropping every \`LEVEL_DECAY_INTERVAL\` until back to normal\n\n**Tips:**\n• Wait 3 seconds between commands to avoid violations\n• If you get blocked, wait for the cooldown to expire\n• Levels decrease automatically when you stop spamming\n• The system is designed to be fair and prevent abuse`
  }
};

// Function to create the main help embed
function createMainHelpEmbed(): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle('🗡️ Insults Bot - Command Help')
    .setDescription('A comprehensive tracking system for monitoring and managing insult patterns in your Discord server')
    .setColor(0xDC143C)
    .addFields(
      {
        name: '📝 Recording Commands',
        value: '`/blame @user insult [note]` - Record an insult against a user\n`/unblame <id>` - Delete a blame record by ID',
        inline: false
      },
      {
        name: '📊 Viewing Commands',
        value: '`/rank` - Show the insult leaderboard\n`/insults [word]` - Show insult statistics\n`/history [@user]` - Show insult history\n`/detail <id>` - Show details for a specific blame record',
        inline: false
      },
      {
        name: '⚙️ Management Commands',
        value: '`/config action:<choice> [options]` - Configure bot settings\n`/radar <enabled>` - Toggle automatic insult detection\n`/archive [@user] [role]` - Show archived blame records\n`/revert <id>` - Restore archived blames back into active records\n`/clear [count]` - Clear DM messages sent by the bot (DM only)',
        inline: false
      }
    );

  embed.addFields({
    name: '🔍 Get Detailed Help',
    value: 'Use the dropdown below to select any command for detailed information, user stories, and examples.',
    inline: false
  });

  return embed.setTimestamp();
}

// Function to create command detail embed
function createCommandDetailEmbed(commandInfo: any): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle(`📖 Command: /${commandInfo.name}`)
    .setDescription(commandInfo.description)
    .setColor(0x5865F2)
    .addFields(
      {
        name: '💻 Usage',
        value: commandInfo.usage,
        inline: false
      },
      {
        name: '👤 User Story',
        value: commandInfo.userStory,
        inline: false
      },
      {
        name: '📋 Details',
        value: commandInfo.details,
        inline: false
      }
    )
    .setTimestamp();
}

async function executeCommand(interaction: ChatInputCommandInteraction) {
  const guildId = interaction.guildId;
  const isDM = !guildId;

  // Create command selection dropdown
  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId('help_command_select')
    .setPlaceholder('Select a command for detailed help...')
    .addOptions([
      new StringSelectMenuOptionBuilder()
        .setLabel('🏠 Back to Main Help')
        .setDescription('Return to the main help overview')
        .setValue('main_help'),
      ...Object.values(COMMAND_INFO).map(cmd => 
        new StringSelectMenuOptionBuilder()
          .setLabel(`/${cmd.name}`)
          .setDescription(cmd.description)
          .setValue(cmd.name)
      )
    ]);

  const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);

  // Show interactive help with dropdown in both DMs and server channels
  const reply = await interaction.reply({ 
    embeds: [createMainHelpEmbed()], 
    components: [row]
  });
  
  // Set timeout to remove dropdown after 5 minutes
  const timeout = setTimeout(async () => {
    try {
      await interaction.editReply({ components: [] });
    } catch (error) {
      // Ignore errors (message might be deleted or interaction expired)
    }
    helpMessageTimeouts.delete(interaction.id);
  }, 300000); // 5 minutes
  
  helpMessageTimeouts.set(interaction.id, timeout);
}

// Function to handle string select menu interactions
export async function handleStringSelect(selectInteraction: StringSelectMenuInteraction) {
  const selectedValue = selectInteraction.values[0];
  
  // Create the dropdown row for reuse
  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId('help_command_select')
    .setPlaceholder('Select a command for detailed help...')
    .addOptions([
      new StringSelectMenuOptionBuilder()
        .setLabel('🏠 Back to Main Help')
        .setDescription('Return to the main help overview')
        .setValue('main_help'),
      ...Object.values(COMMAND_INFO).map(cmd => 
        new StringSelectMenuOptionBuilder()
          .setLabel(`/${cmd.name}`)
          .setDescription(cmd.description)
          .setValue(cmd.name)
      )
    ]);

  const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);
  
  if (selectedValue === 'main_help') {
    // Show main help embed
    await selectInteraction.update({ 
      embeds: [createMainHelpEmbed()], 
      components: [row] // Keep the dropdown for further selections
    });
  } else {
    // Show command detail
    const commandInfo = COMMAND_INFO[selectedValue as keyof typeof COMMAND_INFO];
    
    if (commandInfo) {
      const detailEmbed = createCommandDetailEmbed(commandInfo);
      
      // Update the main message with the selected command details
      await selectInteraction.update({ 
        embeds: [detailEmbed], 
        components: [row] // Keep the dropdown for further selections
      });
    }
  }
  
  // Clear any existing timeout for this interaction and set a new one
  const originalInteractionId = selectInteraction.message.interaction?.id;
  if (originalInteractionId) {
    const existingTimeout = helpMessageTimeouts.get(originalInteractionId);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
    }
    
    // Set new timeout to remove dropdown after 5 minutes
    const timeout = setTimeout(async () => {
      try {
        await selectInteraction.editReply({ components: [] });
      } catch (error) {
        // Ignore errors (message might be deleted or interaction expired)
      }
      helpMessageTimeouts.delete(originalInteractionId);
    }, 300000); // 5 minutes
    
    helpMessageTimeouts.set(originalInteractionId, timeout);
  }
}

// Export with spam protection
export const execute = withSpamProtection(executeCommand);

