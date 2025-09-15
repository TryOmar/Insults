import { EmbedBuilder, User, userMention } from 'discord.js';
import { prisma } from '../database/client.js';
import { formatInsultFrequencyPairs } from '../utils/insultFormatter.js';
import { validateInsultInput, validateNoteInput } from '../utils/insultUtils.js';
import { updateInsulterRole } from './insulterRole.js';

export interface BlameParams {
  guildId: string;
  guildName?: string | null;
  target: User;
  blamer: User;
  insultRaw: string;
  noteRaw?: string | null;
  dmTarget?: boolean;
  guild?: any; // Guild object for role updates
}

export interface BlameSuccess {
  publicEmbed: EmbedBuilder;
  dmEmbed: EmbedBuilder;
  dmSent: boolean;
  insultId: number;
}

export interface BlameError {
  message: string;
}

// Removed normalizeInput function - now using validateInsultInput and validateNoteInput from insultUtils

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
  const { guildId, guildName, target, blamer, insultRaw, noteRaw, dmTarget = true, guild } = params;

  if (!guildId) {
    return { ok: false, error: { message: 'This command can only be used in a server.' } };
  }

  if (target.bot || blamer.bot) {
    return { ok: false, error: { message: 'Bot users are not allowed for this command.' } };
  }

  let insult: string;
  let note: string | null;

  try {
    const validatedInsult = validateInsultInput(insultRaw);
    if (!validatedInsult) {
      return { ok: false, error: { message: 'Invalid insult input.' } };
    }
    insult = validatedInsult;
    note = validateNoteInput(noteRaw ?? null);
  } catch (error) {
    return { ok: false, error: { message: (error as Error).message } };
  }

  // Allow spaces inside the insult phrase; no strict single-token rule

  // Batch all DB work in a single transaction
  const { record, totalBlames, insultCount, grouped } = await prisma.$transaction(async (tx) => {
    await tx.user.upsert({
      where: { id: target.id },
      update: { username: target.username },
      create: { id: target.id, username: target.username },
    });

    await tx.user.upsert({
      where: { id: blamer.id },
      update: { username: blamer.username },
      create: { id: blamer.id, username: blamer.username },
    });

    const created = await tx.insult.create({
      data: {
        guildId,
        userId: target.id,
        blamerId: blamer.id,
        insult,
        note: note && note.length > 0 ? note : null,
      },
    });

    const [totalBlamesTx, insultCountTx, groupedTx] = await Promise.all([
      tx.insult.count({ where: { guildId, userId: target.id } }),
      tx.insult.count({ where: { guildId, insult } }),
      tx.insult.groupBy({
        by: ['insult'],
        where: { guildId, userId: target.id },
        _count: { insult: true },
        orderBy: [{ _count: { insult: 'desc' } }, { insult: 'asc' }],
      })
    ]);

    return { record: created, totalBlames: totalBlamesTx, insultCount: insultCountTx, grouped: groupedTx };
  });
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

  // Update insulter role if guild is provided
  if (guild) {
    try {
      await updateInsulterRole(guild);
    } catch (error) {
      console.error('Failed to update insulter role:', error);
      // Don't fail the blame operation if role update fails
    }
  }

  return { ok: true, data: { publicEmbed, dmEmbed, dmSent, insultId: record.id } };
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

  // Batch all lookups and aggregations in one transaction
  const { targetUser, blamerUser, totalBlames, insultCount, grouped } = await prisma.$transaction(async (tx) => {
    const [targetUserTx, blamerUserTx, totalBlamesTx, insultCountTx, groupedTx] = await Promise.all([
      tx.user.findUnique({ where: { id: userId }, select: { id: true, username: true } }),
      tx.user.findUnique({ where: { id: blamerId }, select: { id: true, username: true } }),
      tx.insult.count({ where: { guildId, userId } }),
      tx.insult.count({ where: { guildId, insult } }),
      tx.insult.groupBy({
        by: ['insult'],
        where: { guildId, userId },
        _count: { insult: true },
        orderBy: [{ _count: { insult: 'desc' } }, { insult: 'asc' }],
      })
    ]);
    return { targetUser: targetUserTx, blamerUser: blamerUserTx, totalBlames: totalBlamesTx, insultCount: insultCountTx, grouped: groupedTx };
  });
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


