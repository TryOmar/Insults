import { ChatInputCommandInteraction, EmbedBuilder, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { withSpamProtection } from '../utils/commandWrapper.js';

export const data = new SlashCommandBuilder()
  .setName('clear')
  .setDescription('Clear DM messages sent by the bot to you')
  .addIntegerOption(option =>
    option
      .setName('count')
      .setDescription('Number of bot messages to clear (default: 50, max: 100)')
      .setMinValue(1)
      .setMaxValue(100)
  );

async function executeCommand(interaction: ChatInputCommandInteraction) {
  const guildId = interaction.guildId;
  const channelType = interaction.channel?.type;
  const count = interaction.options.getInteger('count') ?? 50; // Default to 50 if not specified
  
  // Only allow this command in DMs
  if (guildId) {
    await interaction.reply({ 
      content: 'This command can only be used in private messages (DMs) with the bot.', 
      flags: MessageFlags.Ephemeral 
    });
    return;
  }

  // Send immediate response to prevent interaction timeout
  await interaction.reply({ 
    content: '🔄 Clearing bot messages... This may take a moment.', 
    flags: MessageFlags.Ephemeral 
  });

  try {
    // Create or get the DM channel with the user
    const dmChannel = await interaction.user.createDM();
    
    // Fetch messages in batches until we have enough bot messages or reach the limit
    let allMessages = new Map();
    let totalFetched = 0;
    let botMessagesFound = 0;
    const maxFetchLimit = 100; // Discord's limit per request
    let lastMessageId = undefined;
    
    
    // Keep fetching until we have enough bot messages or hit the limit
    while (botMessagesFound < count && totalFetched < maxFetchLimit) {
      const fetchLimit = Math.min(50, maxFetchLimit - totalFetched); // Fetch in chunks of 50
      const fetchOptions: any = { limit: fetchLimit };
      if (lastMessageId) {
        fetchOptions.before = lastMessageId;
      }
      
      const batch: any = await dmChannel.messages.fetch(fetchOptions);
      
      if (batch.size === 0) break; // No more messages
      
      // Add to our collection
      batch.forEach((msg: any, id: any) => allMessages.set(id, msg));
      totalFetched += batch.size;
      
      // Update last message ID for next batch
      lastMessageId = batch.last()?.id;
      
      // Count bot messages in current collection
      const currentBotMessages = Array.from(allMessages.values()).filter(msg => msg.author.id === interaction.client.user?.id);
      botMessagesFound = currentBotMessages.length;
      
      // If we have enough bot messages, break
      if (botMessagesFound >= count) break;
    }
    
    const messages = Array.from(allMessages.values());
    
    // Filter messages sent by the bot
    const botMessages = messages.filter(msg => msg.author.id === interaction.client.user?.id);
    
    
    if (botMessages.length === 0) {
      await interaction.followUp({ 
        content: 'No messages from the bot found in this DM channel.', 
        flags: MessageFlags.Ephemeral 
      });
      return;
    }

    // Take only the requested number of messages (most recent first)
    const messagesToDelete = Array.from(botMessages.values()).slice(0, count);

    // Delete bot messages individually
    let deletedCount = 0;
    
    // Delete messages individually
    for (const message of messagesToDelete) {
      try {
        if (message && message.deletable) {
          await message.delete();
          deletedCount++;
        }
      } catch (error) {
        // Skip messages that can't be deleted (too old, permissions, etc.)
        console.warn(`Could not delete message ${message.id}:`, error);
      }
    }

    // Create success embed
    const embed = new EmbedBuilder()
      .setTitle('🧹 DM Messages Cleared')
      .setDescription(`Successfully cleared ${deletedCount} of ${count} requested message${count === 1 ? '' : 's'} sent by the bot in this DM channel.`)
      .setColor(0x00FF00)
      .setTimestamp();

    await interaction.followUp({ 
      embeds: [embed], 
      flags: MessageFlags.Ephemeral 
    });

  } catch (error) {
    console.error('Error clearing DM messages:', error);
    
    const errorEmbed = new EmbedBuilder()
      .setTitle('❌ Error')
      .setDescription('An error occurred while trying to clear messages. This might be due to message age limits or permissions.')
      .setColor(0xFF0000)
      .setTimestamp();

    await interaction.followUp({ 
      embeds: [errorEmbed], 
      flags: MessageFlags.Ephemeral 
    });
  }
}

// Export with spam protection
export const execute = withSpamProtection(executeCommand);
