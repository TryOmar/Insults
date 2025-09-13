import { ChatInputCommandInteraction, EmbedBuilder, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { withSpamProtection } from '../utils/commandWrapper.js';

export const data = new SlashCommandBuilder()
  .setName('help')
  .setDescription('Show help information and available commands');

async function executeCommand(interaction: ChatInputCommandInteraction) {
  const guildId = interaction.guildId;
  if (!guildId) {
    await interaction.reply({ content: 'This command can only be used in a server.', flags: MessageFlags.Ephemeral });
    return;
  }

  const embed = new EmbedBuilder()
    .setTitle('🗣️ Insults Bot')
    .setDescription('A comprehensive tracking system for monitoring and managing insult patterns in your Discord server')
    .setColor(0x5865F2)
    .addFields(
      {
        name: '📝 **Recording Commands**',
        value: '`/blame @user insult [note]` - Record an insult against a user\n`/unblame <id>` - Delete a blame record by ID',
        inline: false
      },
      {
        name: '📊 **Viewing Commands**',
        value: '`/rank` - Show the insult leaderboard\n`/insults [word]` - Show insult statistics\n`/history [@user]` - Show insult history\n`/detail <id>` - Show details for a specific blame record',
        inline: false
      },
      {
        name: '⚙️ **Management Commands**',
        value: '`/radar <enabled>` - Toggle automatic insult detection\n`/archive [@user] [role]` - Show archived blame records\n`/revert <id>` - Restore archived blames back into active records',
        inline: false
      },
      {
        name: '',
        value: 'Use these commands to track, analyze, and manage insult patterns in your server',
        inline: false
      }
    )
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}

// Export with spam protection
export const execute = withSpamProtection(executeCommand);

