import { EmbedBuilder, Message, userMention } from 'discord.js';
import { prisma } from '../database/client.js';
import { buildBlameEmbedFromRecord } from '../services/blame.js';
import { guildSetupService } from '../services/guildSetup.js';
import { checkCooldown } from '../utils/cooldown.js';
import { generateInsultCandidates } from './insultUtils.js';

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

// Removed normalizeForRadar and generateNGrams functions - now using generateInsultCandidates from insultUtils

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

  // Generate canonicalized n-grams
  const candidates = generateInsultCandidates(content);

  // Get insults from DB
  const groups = await prisma.insult.groupBy({ by: ['insult'], where: { guildId } });
  if (!groups.length) return;
  
  const insults = new Set(groups.map(g => g.insult));

  // Match by exact string equality
  const hit = candidates.find(c => insults.has(c));
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
  await prisma.user.upsert({
    where: { id: message.author.id },
    update: { username: message.author.username },
    create: { id: message.author.id, username: message.author.username },
  });
  await prisma.user.upsert({
    where: { id: message.client.user.id },
    update: { username: message.client.user.username },
    create: { id: message.client.user.id, username: message.client.user.username },
  });

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
