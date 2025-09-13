import { EmbedBuilder, Message, MessageFlags, userMention } from 'discord.js';
import { prisma } from '../database/client.js';
import { buildBlameEmbedFromRecord } from '../services/blame.js';
import { guildSetupService } from '../services/guildSetup.js';
import { checkCooldown, getCooldownMessage } from '../utils/cooldown.js';

export async function handleMessage(message: Message) {
  // Ignore bot and system messages
  if (message.author.bot || message.system) return;
  if (!message.client.user) return;

  // If the bot is mentioned in the message, reply with ephemeral message directing to /help
  if (message.mentions.has(message.client.user, { ignoreEveryone: true, ignoreRoles: true })) {
    try {
      await message.reply({ 
        content: 'Please use `/help` to see all available commands and learn how to use the bot.'
      });
    } catch {
      // Silently ignore errors (e.g., lack of permission)
    }
  }

  // Handle DM messages
  if (!message.guildId || message.channel.type === 1) {
    // This is a DM message (check both guildId and channel type for better compatibility)
    console.log('DM message received from:', message.author.username, 'Content:', message.content);
    
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
    return; // Don't process radar for DM messages
  }

  // Auto-scan radar
  try {
    const guildId = message.guildId;
    if (!guildId) return;
    
    // Ensure guild setup exists and check if radar is enabled
    const setupSuccess = await guildSetupService.ensureGuildSetup(guildId);
    if (!setupSuccess) {
      // console.warn('[radar] failed to bootstrap setup; disabling radar for message', { guildId });
      return;
    }
    
    const radarEnabled = await guildSetupService.isRadarEnabled(guildId);
    // console.log('[radar] scanning message', { guildId, messageId: message.id, radarEnabled });
    if (!radarEnabled) return;

    const content = message.content;
    if (!content || content.trim().length === 0) return;

    // Normalize helper: collapse to letter/number tokens joined by single spaces
    const normalizeForRadar = (s: string) => s
      .toLowerCase()
      .split(/[^\p{L}\p{Nd}]+/u)
      .filter(Boolean)
      .join(' ');

    const tokens = content
      .toLowerCase()
      .split(/[^\p{L}\p{Nd}]+/u)
      .filter(Boolean);
    // console.log('[radar] tokens', tokens);
    if (tokens.length === 0) return;

    // Build 1-gram, 2-gram, 3-gram candidates from message tokens
    const ngrams: string[] = [];
    const maxN = 3;
    for (let i = 0; i < tokens.length; i++) {
      let current = '';
      for (let n = 1; n <= maxN && i + n <= tokens.length; n++) {
        current = n === 1 ? tokens[i] : current + ' ' + tokens[i + n - 1];
        ngrams.push(current);
      }
    }
    // De-duplicate while preserving order
    const seen = new Set<string>();
    const candidates = ngrams.filter(s => {
      if (seen.has(s)) return false;
      seen.add(s);
      return true;
    });

    // Get distinct bad words from existing insults table for this guild only
    const groups = await prisma.insult.groupBy({ by: ['insult'], where: { guildId } });
    // console.log('[radar] distinct badwords count (guild)', groups.length);
    if (!groups.length) return;
    const badwords = new Set(groups
      .map(g => normalizeForRadar(g.insult))
      .filter(Boolean));
    // console.log('[radar] badwords(size)', badwords.size);

    // Find first matching candidate phrase (1-3 words)
    const hit = candidates.find(t => badwords.has(t));
    // console.log('[radar] hit', hit ?? null);
    if (!hit) return;

    // Record an automatic blame: target = author, blamer = bot-self
    // console.log('[radar] creating blame record');
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
    const note = content.replace(/\n+/g, ' ').trim();

    const record = await prisma.insult.create({
      data: {
        guildId,
        userId: message.author.id,
        blamerId: message.client.user.id,
        insult: hit,
        note: note.length > 0 ? note : null,
      },
    });

    const publicEmbed = await buildBlameEmbedFromRecord('public', record, message.guild?.name);
    const replyMsg = await message.reply({ embeds: [publicEmbed] });
    try {
      await replyMsg.react('👍');
      await replyMsg.react('👎');
    } catch {}
    try {
      await message.react('💀');
    } catch {}


    try {
      const dmEmbed = await buildBlameEmbedFromRecord('dm', record, message.guild?.name);
      await message.author.send({ embeds: [dmEmbed] });
    } catch {
      // ignore DM failures
    }
  } catch (err) {
    // swallow radar errors to avoid spam
    // console.warn('[radar] error while scanning', err);
  }
}
