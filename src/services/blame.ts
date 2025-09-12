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
  let distinctSummary = distinctPairs.join(', ');
  if (distinctSummary.length === 0) distinctSummary = '—';
  if (distinctSummary.length > 1000) {
    const truncated: string[] = [];
    let used = 0;
    for (const part of distinctPairs) {
      const addLen = (truncated.length === 0 ? 0 : 2) + part.length;
      if (used + addLen > 1000) break;
      truncated.push(part);
      used += addLen;
    }
    const remaining = distinctPairs.length - truncated.length;
    distinctSummary = remaining > 0 ? `${truncated.join(', ')} … (+${remaining} more)` : truncated.join(', ');
  }

  const publicEmbed = new EmbedBuilder()
    .setTitle('Blame recorded')
    .addFields(
      { name: 'Insulted User', value: userMention(target.id), inline: true },
      { name: 'Blamed By', value: userMention(blamer.id), inline: true },
      { name: 'Insult', value: insult, inline: false },
      { name: 'Note', value: note && note.length > 0 ? note : '—', inline: false },
      { name: 'Total Blames', value: String(totalBlames), inline: true },
      { name: 'Total Insults', value: distinctSummary, inline: false },
    )
    .setTimestamp(new Date(record.createdAt));

  const dmEmbed = new EmbedBuilder()
    .setTitle('You were blamed')
    .addFields(
      { name: 'Server', value: guildName ?? 'Unknown', inline: true },
      { name: 'By', value: userMention(blamer.id), inline: true },
      { name: 'Insult', value: insult, inline: false },
      { name: 'Note', value: note && note.length > 0 ? note : '—', inline: false },
      { name: 'Total Blames', value: String(totalBlames), inline: true },
      { name: 'Total Insults', value: distinctSummary, inline: false },
    )
    .setTimestamp(new Date(record.createdAt));

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


