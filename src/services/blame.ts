import { EmbedBuilder, User, userMention } from 'discord.js';
import { prisma } from '../database/client.js';

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
  const trimmed = value.trim();
  if (trimmed.length === 0) return '';
  if (trimmed.length > maxLen) return trimmed.slice(0, maxLen);
  if (trimmed.includes('\n')) return trimmed.replace(/\n+/g, ' ');
  return trimmed;
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
  note: string | null;
  totalBlames: number;
  distinctSummary: string;
  recordId: string;
}): EmbedBuilder {
  const { createdAt, guildName, targetId, targetUsername, blamerUsername, blamerId, insult, note, totalBlames, distinctSummary, recordId } = options;

  const embed = new EmbedBuilder();

  // Invisible spacer field for 2-per-line layout
const sep = { name: '\u200B', value: '\u200B', inline: true } as const;

if (type === 'public') {
  embed.setTitle('Blame recorded')
       .setColor(0x00B894)
       .setFooter({ text: 'Blame created' });
} else {
  embed.setTitle(`You were blamed for saying: ${insult}`);
    embed.setColor(0xDC143C) // dark red color
       .setFooter({ text: `Reported on ${guildName ?? 'Unknown'}` });
}

// Row 1: Server | Blame ID
embed.addFields(
  { name: '**Server**', value: guildName ?? 'Unknown', inline: true },
  { name: '**Blame ID**', value: recordId, inline: true },
  sep
);

// Row 2: Insulter | Blamer (render with @username text if provided)
embed.addFields(
  { name: '**Insulter**', value: targetUsername ? `@${targetUsername}` : userMention(targetId), inline: true },
  { name: '**Blamer**', value: blamerUsername ? `@${blamerUsername}` : userMention(blamerId), inline: true },
  sep
);

// Row 3: Insult | Note
const safeNote =
  note && note.length > 0 ? (note.length > 200 ? note.slice(0, 200) : note) : '—';
const toSpoiler = (v: string) => (v === '—' ? v : `||${v}||`);
const wrap = (v: string) => (type === 'dm' ? v : toSpoiler(v));

embed.addFields(
  { name: '**Insult**', value: wrap(insult), inline: true },
  { name: '**Note**', value: wrap(safeNote), inline: true },
  sep
);

// Row 4: Totals (full width, so no sep needed)
const usernameLabel = targetUsername ? `@${targetUsername}` : 'user';

embed.addFields(
  { name: `**Blames against ${usernameLabel}**`, value: String(totalBlames), inline: false },
  { name: `**Insults from ${usernameLabel}**`, value: wrap(distinctSummary), inline: false },
);

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
  const note = normalizeInput(noteRaw ?? null, 200);

  if (!insult) {
    return { ok: false, error: { message: 'Insult must be 1–140 characters.' } };
  }

  if (!/^[\p{L}\p{Nd}]+$/u.test(insult)) {
    return { ok: false, error: { message: 'Insult must be a single token with only letters and numbers. No spaces or symbols.' } };
  }

  await prisma.user.upsert({
    where: { id: target.id },
    update: { username: target.username },
    create: { id: target.id, username: target.username },
  });

  await prisma.user.upsert({
    where: { id: blamer.id },
    update: { username: blamer.username },
    create: { id: blamer.id, username: blamer.username },
  });

  const record = await prisma.insult.create({
    data: {
      guildId,
      userId: target.id,
      blamerId: blamer.id,
      insult,
      note: note && note.length > 0 ? note : null,
    },
  });

  const totalBlames = await prisma.insult.count({ where: { guildId, userId: target.id } });
  const grouped = await prisma.insult.groupBy({
    by: ['insult'],
    where: { guildId, userId: target.id },
    _count: { insult: true },
    orderBy: [{ _count: { insult: 'desc' } }, { insult: 'asc' }],
  });
  const distinctPairs = grouped.map((g) => `${g.insult}(${g._count.insult})`);
  let distinctSummary = '—';
  if (distinctPairs.length > 0) {
    let buffer = '';
    let used = 0;
    let itemsOnLine = 0;
    let added = 0;
    for (let i = 0; i < distinctPairs.length; i++) {
      const part = distinctPairs[i];
      const sep = itemsOnLine === 0 ? '' : ', ';
      const prospective = sep + part;
      const prospectiveLen = prospective.length;
      if (used + prospectiveLen > 1000) break;
      buffer += prospective;
      used += prospectiveLen;
      itemsOnLine++;
      added++;
      if (itemsOnLine === 6 && i !== distinctPairs.length - 1) {
        if (used + 1 > 1000) break; // for '\n'
        buffer += '\n';
        used += 1;
        itemsOnLine = 0;
      }
    }
    const remaining = distinctPairs.length - added;
    distinctSummary = remaining > 0 ? `${buffer} … (+${remaining} more)` : buffer;
  }

  const publicEmbed = buildBlameEmbed('public', {
    createdAt: new Date(record.createdAt),
    guildName,
    targetId: target.id,
    targetUsername: target.username,
    blamerUsername: blamer.username,
    blamerId: blamer.id,
    insult,
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


