import { EmbedBuilder, Message, userMention } from 'discord.js';
import { prisma } from '../database/client.js';
import { buildBlameEmbedFromRecord } from '../services/blame.js';
import { guildSetupService } from '../services/guildSetup.js';
import { checkCooldown } from '../utils/cooldown.js';
import { generateInsultCandidates } from './insultUtils.js';
import { logGameplayAction } from './channelLogging.js';
import { setupCache } from './setupCache.js';

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
 * Creates a radar blame embed for DM
 */
function createRadarBlameDMEmbed(insult: string, guildName: string | undefined, originalContent: string): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle(`🚨 Radar detected insult: ||${insult}||`)
    .setDescription('Your message was automatically flagged by the radar system for containing an insult.')
    .setColor(0xDC143C) // Dark red
    .addFields(
      { name: '**Server**', value: guildName ?? 'Unknown', inline: true },
      { name: '**Detected Insult**', value: `||${insult}||`, inline: true },
      { name: '**Original Message**', value: `||${originalContent.replace(/\n+/g, ' ').trim()}||`, inline: false }
    )
    .setFooter({ text: 'Automated radar detection' })
    .setTimestamp();
}

/**
 * Creates a radar delete embed for DM
 */
function createRadarDeleteDMEmbed(insult: string, guildName: string | undefined, originalContent: string): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle(`🗑️ Message deleted: ||${insult}||`)
    .setColor(0xFF6B6B) // Light red
    .addFields(
      { name: '**Server**', value: guildName ?? 'Unknown', inline: true },
      { name: '**Detected Insult**', value: `||${insult}||`, inline: true },
      { name: '**Original Message**', value: `||${originalContent.replace(/\n+/g, ' ').trim()}||`, inline: false }
    )
    .setFooter({ text: 'Automated radar deletion' })
    .setTimestamp();
}


/**
 * Creates a radar blame embed for insults channel
 */
function createRadarBlameChannelEmbed(insult: string, guildName: string | undefined, targetUser: string, originalContent: string): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle('🚨 Radar Blame Recorded')
    .setDescription(`**${targetUser}** was automatically blamed by radar`)
    .setColor(0x00B894) // Teal
    .addFields(
      { name: '**Target**', value: userMention(targetUser), inline: true },
      { name: '**Insult**', value: `||${insult}||`, inline: true },
      { name: '**Original Message**', value: `||${originalContent.replace(/\n+/g, ' ').trim()}||`, inline: false }
    )
    .setFooter({ text: 'Automated radar detection' })
    .setTimestamp();
}

/**
 * Creates a radar delete embed for insults channel
 */
function createRadarDeleteChannelEmbed(insult: string, guildName: string | undefined, targetUser: string, originalContent: string): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle(`🗑️ Radar Message Deleted: ||${insult}||`)
    .setColor(0xFF6B6B) // Light red
    .addFields(
      { name: '**Target**', value: userMention(targetUser), inline: true },
      { name: '**Insult**', value: `||${insult}||`, inline: true },
      { name: '**Original Message**', value: `||${originalContent.replace(/\n+/g, ' ').trim()}||`, inline: false }
    )
    .setFooter({ text: 'Automated radar deletion' })
    .setTimestamp();
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
  
  const radarMode = await guildSetupService.getRadarMode(guildId);
  if (radarMode === 'off') return;

  const content = message.content;
  if (!content || content.trim().length === 0) return;

  // Generate canonicalized n-grams
  const candidates = generateInsultCandidates(content);

  // Get insults from DB (single lightweight query)
  const groups = await prisma.insult.groupBy({ by: ['insult'], where: { guildId } });
  if (!groups.length) return;
  
  const insults = new Set(groups.map(g => g.insult));

  // Match by exact string equality - find ALL matches
  const hits = candidates.filter(c => insults.has(c));
  if (!hits.length) return;

  // Handle different radar modes for each detected insult
  for (const hit of hits) {
    if (radarMode === 'blame') {
      // Record an automatic blame: target = author, blamer = bot-self
      await recordAutoBlame(message, hit, content, 'blame');
    } else if (radarMode === 'delete') {
      // Delete the message
      await deleteMessage(message, hit);
    } else if (radarMode === 'both') {
      // Both blame and delete - do blame first, then delete
      await recordAutoBlame(message, hit, content, 'both');
      await deleteMessageForBothMode(message, hit, content);
    }
  }
}

/**
 * Records an automatic blame when radar detects an insult
 */
async function recordAutoBlame(message: Message, insult: string, originalContent: string, mode: 'blame' | 'both' = 'blame'): Promise<void> {
  if (!message.guildId || !message.client.user) return;

  // Ensure FK rows exist and create record in a single transaction
  const { record } = await prisma.$transaction(async (tx) => {
    await tx.user.upsert({
      where: { id: message.author.id },
      update: { username: message.author.username },
      create: { id: message.author.id, username: message.author.username },
    });
    await tx.user.upsert({
      where: { id: message.client.user.id },
      update: { username: message.client.user.username },
      create: { id: message.client.user.id, username: message.client.user.username },
    });

    // Include the author's original message as the note (newlines collapsed; no truncation)
    const note = originalContent.replace(/\n+/g, ' ').trim();

    // Compute next guild-scoped ID inside the same transaction
    const guildId = message.guildId as string;
    const [maxInsult, maxArchive] = await Promise.all([
      tx.insult.aggregate({ _max: { id: true }, where: { guildId } }),
      tx.archive.aggregate({ _max: { id: true }, where: { guildId } }),
    ]);
    const nextId = Math.max(maxInsult._max.id ?? 0, maxArchive._max.id ?? 0) + 1;

    const created = await tx.insult.create({
      data: {
        id: nextId,
        guildId,
        userId: message.author.id,
        blamerId: message.client.user.id,
        insult: insult,
        note: note.length > 0 ? note : null,
      },
    });
    return { record: created };
  });

  // Send public embed with reactions
  let publicEmbed = await buildBlameEmbedFromRecord('public', record, message.guild?.name);
  if (mode === 'both') {
    // For both mode, add deletion note to public embed too
    publicEmbed.addFields({ 
      name: '**Radar Action**', 
      value: 'Message was also deleted by radar', 
      inline: false 
    });
  }
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
    if (mode === 'both') {
      // For both mode, use blame embed with deletion note (same as insults channel)
      const dmEmbed = await buildBlameEmbedFromRecord('dm', record, message.guild?.name);
      dmEmbed.addFields({ 
        name: '**Radar Action**', 
        value: 'Message was also deleted by radar', 
        inline: false 
      });
      await message.author.send({ embeds: [dmEmbed] });
    } else {
      // For blame-only mode, use normal blame embed
      const dmEmbed = await buildBlameEmbedFromRecord('dm', record, message.guild?.name);
      await message.author.send({ embeds: [dmEmbed] });
    }
  } catch {
    // ignore DM failures
  }

  // Send embed to insults channel
  try {
    if (message.guild) {
      let insultsChannelEmbed;
      if (mode === 'both') {
        // For both mode, use normal blame embed but add deletion note
        insultsChannelEmbed = await buildBlameEmbedFromRecord('public', record, message.guild?.name);
        insultsChannelEmbed.addFields({ 
          name: '**Radar Action**', 
          value: 'Message was also deleted by radar', 
          inline: false 
        });
      } else {
        // For blame-only mode, use normal blame embed
        insultsChannelEmbed = await buildBlameEmbedFromRecord('public', record, message.guild?.name);
      }
      
      await logGameplayAction(message.guild, {
        action: mode === 'both' ? 'radar-both' : 'radar-blame',
        target: message.author,
        insult: insult,
        originalMessage: originalContent,
        embed: insultsChannelEmbed
      });
    }
  } catch (error) {
    console.warn('Failed to log radar blame to insults channel:', error);
  }
}

/**
 * Deletes a message for both mode (without sending any embeds)
 */
async function deleteMessageForBothMode(message: Message, insult: string, originalContent: string): Promise<void> {
  if (!message.guildId || !message.client.user) return;

  try {
    // Delete the message (no embeds needed since blame already sent them)
    await message.delete();
  } catch (error) {
    console.warn(`⚠️ Failed to delete message ${message.id} in guild ${message.guildId}:`, error);
  }
}

/**
 * Deletes a message when radar detects an insult
 */
async function deleteMessage(message: Message, insult: string): Promise<void> {
  if (!message.guildId || !message.client.user) return;

  try {
    // Store original content before deletion
    const originalContent = message.content;
    
    // Add skull reaction to the message
    try {
      await message.react('💀');
    } catch {}
    
    // Reply with deletion embed
    const publicEmbed = createRadarDeleteChannelEmbed(insult, message.guild?.name, message.author.id, originalContent);
    const replyMsg = await message.reply({ embeds: [publicEmbed] });
    
    // Delete the message
    await message.delete();
    
    // Send DM embed to the user
    try {
      const dmEmbed = createRadarDeleteDMEmbed(insult, message.guild?.name, originalContent);
      await message.author.send({ embeds: [dmEmbed] });
    } catch {
      // ignore DM failures
    }

    // Send professional embed to insults channel
    try {
      if (message.guild) {
        await logGameplayAction(message.guild, {
          action: 'radar-delete',
          target: message.author,
          insult: insult,
          originalMessage: originalContent,
          embed: publicEmbed
        });
      }
    } catch (error) {
      console.warn('Failed to log radar delete to insults channel:', error);
    }
  } catch (error) {
    console.warn(`⚠️ Failed to delete message ${message.id} in guild ${message.guildId}:`, error);
  }
}
