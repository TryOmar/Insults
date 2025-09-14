import { EmbedBuilder, User, userMention } from 'discord.js';
import { prisma } from '../database/client.js';
import { formatInsultFrequencyPairs } from '../utils/insultFormatter.js';
import { safeGroupInsultsByText, safeCountInsultsWithConditions } from '../queries/insults.js';
import { safeUpsertUser, safeFindUserById } from '../queries/users.js';

export interface BlameParams {
  guildId: string;
  guildName?: string | null;
  target: User;
  blamer: User;
  insultRaw: string;
  noteRaw?: string | null;
  dmTarget?: boolean;
}

export interface BlameSuccess {
  publicEmbed: EmbedBuilder;
  dmEmbed: EmbedBuilder;
  dmSent: boolean;
}

export interface BlameError {
  message: string;
}

function normalizeInput(value: string | null | undefined, maxLen: number): string | null {
  if (value == null) return null;
  // Remove only leading spaces; keep internal and trailing spaces
  let normalized = value.replace(/^\s+/, '');
  // Replace newlines with a single space (Discord inputs rarely include these)
  if (normalized.includes('\n')) normalized = normalized.replace(/\n+/g, ' ');
  if (normalized.length === 0) return '';
  if (normalized.length > maxLen) normalized = normalized.slice(0, maxLen);
  // Store as lowercase for consistency
  return normalized.toLowerCase();
}

export type BlameEmbedType = 'public' | 'dm';

export function buildBlameEmbed(type: BlameEmbedType, options: {
  createdAt: Date;
  guildName?: string | null;
  targetId: string;
  targetUsername?: string;
  blamerUsername?: string;
  blamerId: string;
  insult: string;
  insultCount: number;
  note: string | null;
  totalBlames: number;
  distinctSummary: string;
  recordId: string;
}): EmbedBuilder {
  const { createdAt, guildName, targetId, targetUsername, blamerUsername, blamerId, insult, insultCount, note, totalBlames, distinctSummary, recordId } = options;

  const embed = new EmbedBuilder();

  if (type === 'public') {
    embed.setTitle('Blame recorded')
         .setColor(0x00B894)
         .setFooter({ text: 'Blame created' });
  } else {
    embed.setTitle(`You were blamed for saying: ${insult}`)
         .setColor(0xDC143C) // dark red color
         .setFooter({ text: `Reported on ${guildName ?? 'Unknown'}` });
  }
  
  // Row 1: Server | Blame ID
  embed.addFields(
    { name: '**Server**', value: guildName ?? 'Unknown', inline: true },
    { name: '**Blame ID**', value: recordId, inline: true }
  );
  
  // Row 2: Insulter
  embed.addFields(
    { name: '**Insulter**', value: userMention(targetId), inline: false }
  );
  
  // Row 3: Insult | Frequency (server-wide)
  const safeNote = note && note.length > 0 ? note : '—';
  const toSpoiler = (v: string) => (v === '—' ? v : `||${v}||`);
  const wrap = (v: string) => (type === 'dm' ? v : toSpoiler(v));
  
  embed.addFields(
    { name: '**Insult**', value: wrap(insult), inline: true },
    { name: '**Frequency (server-wide)**', value: String(insultCount), inline: true }
  );
  
  // Row 4: Note
  embed.addFields(
    { name: '**Note**', value: wrap(safeNote), inline: false }
  );
  
  // Row 5: Blamer
  embed.addFields(
    { name: '**Blamer**', value: userMention(blamerId), inline: false }
  );
  
  const usernameLabel = targetUsername ? `@${targetUsername}` : 'user';
  
  // Row 6: Blames against | Insults from
  embed.addFields({
    name: `**Total Insults from ${usernameLabel}: ${totalBlames}**`,    value: wrap(distinctSummary), inline: false
  });
  
  embed.setTimestamp(new Date(createdAt));
  
  return embed;  
}

export async function blameUser(params: BlameParams): Promise<{ ok: true; data: BlameSuccess } | { ok: false; error: BlameError }> {
  const { guildId, guildName, target, blamer, insultRaw, noteRaw, dmTarget = true } = params;

  if (!guildId) {
    return { ok: false, error: { message: 'This command can only be used in a server.' } };
  }

  if (target.bot || blamer.bot) {
    return { ok: false, error: { message: 'Bot users are not allowed for this command.' } };
  }

  const insult = normalizeInput(insultRaw, 140);
  // Set reasonable limit for notes (500 characters)
  const note = normalizeInput(noteRaw ?? null, 500);

  if (!insult) {
    return { ok: false, error: { message: 'Insult must be 1–140 characters.' } };
  }

  // Enforce up to 3 words for consistency with radar (supports 1–3 word phrases)
  const words = insult.split(/\s+/).filter(Boolean);
  const wordCount = words.length;
  if (wordCount > 3) {
    return { ok: false, error: { message: 'Insult must be a single phrase of up to 3 words.' } };
  }

  // Check individual word length (max 20 characters per word)
  for (const word of words) {
    if (word.length > 20) {
      return { ok: false, error: { message: 'Each insult word must be 20 characters or less.' } };
    }
  }

  // Validate note length
  if (note && note.length > 500) {
    return { ok: false, error: { message: 'Note must be 500 characters or less.' } };
  }

  // Allow spaces inside the insult phrase; no strict single-token rule

  await safeUpsertUser(target.id, target.username);
  await safeUpsertUser(blamer.id, blamer.username);

  const record = await prisma.insult.create({
    data: {
      guildId,
      userId: target.id,
      blamerId: blamer.id,
      insult,
      note: note && note.length > 0 ? note : null,
    },
  });

  const totalBlames = await safeCountInsultsWithConditions(guildId, { userId: target.id });
  const insultCount = await safeCountInsultsWithConditions(guildId, { insult });
  const grouped = await safeGroupInsultsByText(guildId, target.id);
  const distinctSummary = formatInsultFrequencyPairs(grouped);

  const publicEmbed = buildBlameEmbed('public', {
    createdAt: new Date(record.createdAt),
    guildName,
    targetId: target.id,
    targetUsername: target.username,
    blamerUsername: blamer.username,
    blamerId: blamer.id,
    insult,
    insultCount,
    note,
    totalBlames,
    distinctSummary,
    recordId: String(record.id),
  });

  const dmEmbed = buildBlameEmbed('dm', {
    createdAt: new Date(record.createdAt),
    guildName,
    targetId: target.id,
    targetUsername: target.username,
    blamerUsername: blamer.username,
    blamerId: blamer.id,
    insult,
    insultCount,
    note,
    totalBlames,
    distinctSummary,
    recordId: String(record.id),
  });

  let dmSent = false;
  if (dmTarget) {
    try {
      await target.send({ embeds: [dmEmbed] });
      dmSent = true;
    } catch {
      dmSent = false;
    }
  }

  return { ok: true, data: { publicEmbed, dmEmbed, dmSent } };
}


export interface BlameRecordShape {
  id: number;
  guildId: string;
  userId: string;
  blamerId: string;
  insult: string;
  note: string | null;
  createdAt: Date;
}

export async function buildBlameEmbedFromRecord(type: BlameEmbedType, record: BlameRecordShape, guildName?: string | null): Promise<EmbedBuilder> {
  const { guildId, userId, blamerId, insult, note, createdAt, id } = record;

  const [targetUser, blamerUser] = await Promise.all([
    safeFindUserById(userId),
    safeFindUserById(blamerId),
  ]);

  const totalBlames = await safeCountInsultsWithConditions(guildId, { userId });
  const insultCount = await safeCountInsultsWithConditions(guildId, { insult });

  const grouped = await safeGroupInsultsByText(guildId, userId);
  const distinctSummary = formatInsultFrequencyPairs(grouped);

  return buildBlameEmbed(type, {
    createdAt,
    guildName: guildName ?? null,
    targetId: targetUser?.id ?? userId,
    targetUsername: targetUser?.username,
    blamerUsername: blamerUser?.username,
    blamerId: blamerUser?.id ?? blamerId,
    insult,
    insultCount,
    note,
    totalBlames,
    distinctSummary,
    recordId: String(id),
  });
}


