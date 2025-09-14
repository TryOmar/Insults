import { EmbedBuilder, Message, userMention } from 'discord.js';
import { prisma } from '../database/client.js';
import { buildBlameEmbedFromRecord } from '../services/blame.js';
import { guildSetupService } from '../services/guildSetup.js';
import { checkCooldown } from '../utils/cooldown.js';
import { safeGroupInsultsByText } from '../queries/insults.js';
import { safeUpsertUser } from '../queries/users.js';

/**
 * Handles when the bot is mentioned in a message
 */
export async function handleBotMention(message: Message): Promise<void> {
  if (!message.client.user) return;
  
  if (message.mentions.has(message.client.user, { ignoreEveryone: true, ignoreRoles: true })) {
    try {
      await message.reply({ 
        content: 'Please use `/help` to see all available commands and learn how to use the bot.'
      });
    } catch {
      // Silently ignore errors (e.g., lack of permission)
    }
  }
}

/**
 * Handles DM messages sent to the bot
 */
export async function handleDMMessage(message: Message): Promise<void> {
  // Check cooldown for DM messages
  const cooldownResult = checkCooldown(message.author);
  if (!cooldownResult.allowed) {
    // Silently ignore DM messages during cooldown - no reply at all
    console.log('DM ignored due to cooldown:', message.author.username, 'Reason:', cooldownResult.reason, 'Remaining:', cooldownResult.remaining + 'ms');
    return; // Don't process further and don't reply
  }
  
  try {
    const embed = new EmbedBuilder()
      .setTitle('🗡️ Insults Bot')
      .setDescription('Hello! I\'m the Insults Bot that helps track and manage insult patterns in Discord servers.')
      .setColor(0xDC143C)
      .addFields(
        {
          name: 'What I do:',
          value: '• Record and track insults between users\n• Generate leaderboards and statistics\n• Provide detailed history and analytics\n• Help moderate server interactions',
          inline: false
        },
        {
          name: 'Get Started:',
          value: 'Use `/help` to see all available commands and learn how to use me!',
          inline: false
        },
        {
          name: 'DM Commands:',
          value: '• `/clear` - Clear bot messages in this DM\n• `/help` - View all available commands',
          inline: false
        }
      )
      .setTimestamp()
      .setFooter({ text: 'Tip: Most commands work in servers, but some are DM-only!' });

    await message.reply({ embeds: [embed] });
    console.log('DM response sent successfully to:', message.author.username);
  } catch (error) {
    console.error('Failed to send DM response to:', message.author.username, 'Error:', error);
    // Silently ignore errors (e.g., user has DMs disabled)
  }
}

/**
 * Extracts exact words from text for radar scanning (preserves original case and spacing)
 */
export function extractExactWords(text: string): string[] {
  return text
    .split(/\s+/)
    .filter(word => word.length > 0);
}

/**
 * Generates n-grams from a list of exact words
 */
export function generateNGrams(words: string[], maxN: number = 3): string[] {
  const ngrams: string[] = [];
  
  for (let i = 0; i < words.length; i++) {
    let current = '';
    for (let n = 1; n <= maxN && i + n <= words.length; n++) {
      current = n === 1 ? words[i] : current + ' ' + words[i + n - 1];
      ngrams.push(current);
    }
  }
  
  // De-duplicate while preserving order
  const seen = new Set<string>();
  return ngrams.filter(s => {
    if (seen.has(s)) return false;
    seen.add(s);
    return true;
  });
}

/**
 * Scans a message for insults using radar functionality
 */
export async function scanMessageForInsults(message: Message): Promise<void> {
  const guildId = message.guildId;
  if (!guildId || !message.client.user) return;
  
  // Ensure guild setup exists and check if radar is enabled
  const setupSuccess = await guildSetupService.ensureGuildSetup(guildId);
  if (!setupSuccess) {
    return;
  }
  
  const radarEnabled = await guildSetupService.isRadarEnabled(guildId);
  if (!radarEnabled) return;

  const content = message.content;
  if (!content || content.trim().length === 0) return;

  // Extract exact words from the message content
  const words = extractExactWords(content);
  
  if (words.length === 0) return;

  // Generate n-gram candidates
  const candidates = generateNGrams(words);

  // Get distinct bad words from existing insults table for this guild only
  const groups = await safeGroupInsultsByText(guildId);
  if (!groups.length) return;
  
  const badwords = new Set(groups
    .map(g => g.insult)
    .filter(Boolean));

  // Find first matching candidate phrase (1-3 words)
  const hit = candidates.find(t => badwords.has(t));
  if (!hit) return;

  // Record an automatic blame: target = author, blamer = bot-self
  await recordAutoBlame(message, hit, content);
}

/**
 * Records an automatic blame when radar detects an insult
 */
async function recordAutoBlame(message: Message, insult: string, originalContent: string): Promise<void> {
  if (!message.guildId || !message.client.user) return;

  // Ensure FK rows exist
  await safeUpsertUser(message.author.id, message.author.username);
  await safeUpsertUser(message.client.user.id, message.client.user.username);

  // Include the author's original message as the note (newlines collapsed; no truncation)
  const note = originalContent.replace(/\n+/g, ' ').trim();

  const record = await prisma.insult.create({
    data: {
      guildId: message.guildId,
      userId: message.author.id,
      blamerId: message.client.user.id,
      insult: insult,
      note: note.length > 0 ? note : null,
    },
  });

  // Send public embed with reactions
  const publicEmbed = await buildBlameEmbedFromRecord('public', record, message.guild?.name);
  const replyMsg = await message.reply({ embeds: [publicEmbed] });
  
  try {
    await replyMsg.react('👍');
    await replyMsg.react('👎');
  } catch {}
  
  try {
    await message.react('💀');
  } catch {}

  // Send DM to the user
  try {
    const dmEmbed = await buildBlameEmbedFromRecord('dm', record, message.guild?.name);
    await message.author.send({ embeds: [dmEmbed] });
  } catch {
    // ignore DM failures
  }
}
