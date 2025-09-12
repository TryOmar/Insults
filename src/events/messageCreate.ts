import { EmbedBuilder, Message, userMention } from 'discord.js';
import { prisma } from '../database/client.js';
import { buildBlameEmbedFromRecord } from '../services/blame.js';

export async function handleMessage(message: Message) {
  // Ignore bot and system messages
  if (message.author.bot || message.system) return;
  if (!message.client.user) return;

  // If the bot is mentioned in the message, reply with info
  if (message.mentions.has(message.client.user, { ignoreEveryone: true, ignoreRoles: true })) {
    const embed = new EmbedBuilder()
      .setTitle('Insults Bot')
      .setDescription('Track and analyze playful insults in your server.')
      .addFields(
        { name: 'Commands', value: '`/blame @user insult [note]`, `/rank`' },
        { name: 'How it works', value: 'Records who blamed whom, when, with optional notes. Shows leaderboards and per-user histories.' },
      )
      .setFooter({ text: 'Tip: Use /rank to see the leaderboard.' })
      .setTimestamp();

    try {
      await message.reply({ embeds: [embed] });
    } catch {
      // Silently ignore errors (e.g., lack of permission)
    }
  }

  // Auto-scan radar
  try {
    const guildId = message.guildId;
    if (!guildId) return;
    const setup = await prisma.setup.findUnique({ where: { guildId } });
    console.log('[radar] scanning message', { guildId, messageId: message.id, radarEnabled: (setup as any)?.radarEnabled ?? undefined });
    //if (!setup || !setup.radarEnabled) return;

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
    console.log('[radar] tokens', tokens);
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

    // Get distinct bad words from existing insults table for this guild; fallback to global if none in guild
    let groups = await prisma.insult.groupBy({ by: ['insult'], where: { guildId } });
    console.log('[radar] distinct badwords count (guild)', groups.length);
    if (!groups.length) {
      const globalGroups = await prisma.insult.groupBy({ by: ['insult'] });
      console.log('[radar] distinct badwords count (global fallback)', globalGroups.length);
      groups = globalGroups;
    }
    if (!groups.length) return;
    const badwords = new Set(groups
      .map(g => normalizeForRadar(g.insult))
      .filter(Boolean));
    console.log('[radar] badwords(size)', badwords.size);

    // Find first matching candidate phrase (1-3 words)
    const hit = candidates.find(t => badwords.has(t));
    console.log('[radar] hit', hit ?? null);
    if (!hit) return;

    // Record an automatic blame: target = author, blamer = bot-self
    console.log('[radar] creating blame record');
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
    await message.reply({ embeds: [publicEmbed] });
    await message.react('👍');
    await message.react('👎');


    try {
      const dmEmbed = await buildBlameEmbedFromRecord('dm', record, message.guild?.name);
      await message.author.send({ embeds: [dmEmbed] });
    } catch {
      // ignore DM failures
    }
  } catch (err) {
    // swallow radar errors to avoid spam
    console.warn('[radar] error while scanning', err);
  }
}
