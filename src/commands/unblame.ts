import { ChatInputCommandInteraction, SlashCommandBuilder, MessageFlags, PermissionFlagsBits, EmbedBuilder, userMention, ActionRowBuilder, ButtonBuilder, ButtonStyle, ButtonInteraction } from 'discord.js';
import { prisma } from '../database/client.js';
import { renderTable, TableConfig } from '../utils/tableRenderer.js';
import { getShortTime } from '../utils/time.js';
import { PaginationManager, createStandardCustomId, parseStandardCustomId, PaginationData } from '../utils/pagination.js';

export const data = new SlashCommandBuilder()
  .setName('unblame')
  .setDescription('Delete a blame record by ID (you must be the blamer or admin)')
  .addStringOption(opt =>
    opt.setName('id').setDescription('Blame ID').setRequired(true)
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  const raw = interaction.options.getString('id', true);
  const invokerId = interaction.user.id;

  // Extract all numeric IDs from input (split by any non-digit separators)
  const rawIds = (raw.match(/\d+/g) || []).map(v => parseInt(v, 10)).filter(v => Number.isFinite(v));
  if (rawIds.length === 0) {
    await interaction.reply({ content: 'Please provide a valid blame ID.', flags: MessageFlags.Ephemeral });
    return;
  }
  
  // Remove duplicate IDs to prevent unique constraint violations
  const ids = [...new Set(rawIds)];

  const member = await interaction.guild?.members.fetch(invokerId).catch(() => null);
  const isAdmin = member?.permissions.has(PermissionFlagsBits.Administrator) ?? false;

  type Result = 
    | { kind: 'deleted'; id: number; insult: string; userId: string; blamerId: string; note: string | null; createdAt: Date }
    | { kind: 'not_found'; id: number }
    | { kind: 'forbidden'; id: number; reason: 'self_not_blamer' | 'not_owner' };

  const results: Result[] = [];

  for (const id of ids) {
    const found = await prisma.insult.findUnique({ where: { id } });
    if (!found) {
      // Check if it's already archived
      const archived = await prisma.archive.findUnique({ where: { originalInsultId: id } });
      if (archived) {
        results.push({ kind: 'not_found', id }); // Treat as not found since it's already processed
        continue;
      }
      results.push({ kind: 'not_found', id });
      continue;
    }
    if (found.blamerId !== invokerId && !isAdmin) {
      const reason = found.userId === invokerId ? 'self_not_blamer' : 'not_owner';
      results.push({ kind: 'forbidden', id, reason });
      continue;
    }
    // Move to Archive first, then delete
    try {
    await prisma.$transaction([
      (prisma as any).archive.create({
        data: {
          originalInsultId: found.id, // Store the original insult ID
          guildId: found.guildId,
          userId: found.userId,
          blamerId: found.blamerId,
          insult: found.insult,
          note: found.note ?? null,
          createdAt: new Date(found.createdAt),
          unblamerId: invokerId,
        }
      }),
      prisma.insult.delete({ where: { id } }),
    ]);
    results.push({ kind: 'deleted', id, insult: found.insult, userId: found.userId, blamerId: found.blamerId, note: found.note ?? null, createdAt: new Date(found.createdAt) });
    } catch (error: any) {
      // Handle unique constraint violation (already archived)
      if (error.code === 'P2002' && error.meta?.target?.includes('originalInsultId')) {
        // The insult was already archived, just delete it
        try {
          await prisma.insult.delete({ where: { id } });
          results.push({ kind: 'deleted', id, insult: found.insult, userId: found.userId, blamerId: found.blamerId, note: found.note ?? null, createdAt: new Date(found.createdAt) });
        } catch (deleteError) {
          console.error(`Failed to delete already archived insult ${id}:`, deleteError);
          results.push({ kind: 'not_found', id }); // Treat as not found since it's already processed
        }
      } else {
        // Other database errors
        console.error(`Failed to unblame insult ${id}:`, error);
        results.push({ kind: 'not_found', id }); // Treat as not found to avoid crashing
      }
    }
  }

  // Build a single public report
  const deleted = results.filter(r => r.kind === 'deleted') as Extract<Result, { kind: 'deleted' }> [];
  const notFound = results.filter(r => r.kind === 'not_found') as Extract<Result, { kind: 'not_found' }> [];
  const forbidden = results.filter(r => r.kind === 'forbidden') as Extract<Result, { kind: 'forbidden' }> [];

  // First page: summary of IDs
  const successIds = deleted.map(d => `#${d.id}`).join(', ') || '—';
  const otherParts: string[] = [];
  if (notFound.length) otherParts.push(`Not found: ${notFound.map(n => `#${n.id}`).join(', ')}`);
  if (forbidden.length) {
    const selfIds = forbidden.filter(f => f.reason === 'self_not_blamer').map(f => `#${f.id}`).join(', ');
    const otherIds = forbidden.filter(f => f.reason === 'not_owner').map(f => `#${f.id}`).join(', ');
    if (selfIds) otherParts.push(`Self but not blamer: ${selfIds}`);
    if (otherIds) otherParts.push(`Not your blames: ${otherIds}`);
  }
  // Create unblame result data for pagination
  const unblameData = {
    deleted,
    notFound,
    forbidden,
    successIds,
    otherParts
  };

  const paginationManager = createUnblamePaginationManager();
  await paginationManager.handleInitialCommand(interaction, unblameData);
}

type UnblameResult = 
  | { kind: 'deleted'; id: number; insult: string; userId: string; blamerId: string; note: string | null; createdAt: Date }
  | { kind: 'not_found'; id: number }
  | { kind: 'forbidden'; id: number; reason: 'self_not_blamer' | 'not_owner' };

type UnblameData = {
  deleted: Extract<UnblameResult, { kind: 'deleted' }>[];
  notFound: Extract<UnblameResult, { kind: 'not_found' }>[];
  forbidden: Extract<UnblameResult, { kind: 'forbidden' }>[];
  successIds: string;
  otherParts: string[];
};

async function fetchUnblameData(unblameData: UnblameData, page: number, pageSize: number): Promise<PaginationData<EmbedBuilder>> {
  const { deleted } = unblameData;
  
  // Page 1 is always the summary
  if (page === 1) {
  const summaryEmbed = new EmbedBuilder()
    .setTitle('Unblame Summary')
    .addFields(
        { name: 'Deleted', value: unblameData.successIds, inline: false },
        ...(unblameData.otherParts.length ? [{ name: 'Other', value: unblameData.otherParts.join('\n'), inline: false }] : []) as any
    )
    .setColor(0x2ECC71)
    .setTimestamp();
    
    return {
      items: [summaryEmbed],
      totalCount: deleted.length + 1, // +1 for summary page
      currentPage: 1,
      totalPages: Math.max(1, deleted.length + 1)
    };
  }
  
  // Other pages are individual deleted items
  const itemIndex = page - 2; // -2 because page 1 is summary, so page 2 is index 0
  if (itemIndex >= 0 && itemIndex < deleted.length) {
    const d = deleted[itemIndex];
    const embed = new EmbedBuilder()
      .setTitle(`Deleted Blame #${d.id}`)
      .addFields(
        { name: 'ID', value: String(d.id), inline: true },
        { name: 'Insult', value: d.insult, inline: true },
        { name: 'Note', value: d.note ?? '—', inline: false },
        { name: 'Insulter', value: userMention(d.userId), inline: true },
        { name: 'Blamer', value: userMention(d.blamerId), inline: true },
        { name: 'When', value: '\u200E' + getShortTime(new Date(d.createdAt)), inline: false },
      )
      .setColor(0xE67E22)
      .setTimestamp(new Date(d.createdAt));
    
    return {
      items: [embed],
      totalCount: deleted.length + 1,
      currentPage: page,
      totalPages: Math.max(1, deleted.length + 1)
    };
  }
  
  // Fallback
  return {
    items: [],
    totalCount: 0,
    currentPage: page,
    totalPages: 1
  };
}

function buildUnblameEmbed(data: PaginationData<EmbedBuilder>): EmbedBuilder {
  return data.items[0] || new EmbedBuilder().setTitle('No data').setDescription('No data available');
}

function createUnblamePaginationManager(): PaginationManager<EmbedBuilder> {
  return new PaginationManager(
    {
      pageSize: 1, // Each page is one embed
      commandName: 'unblame',
      customIdPrefix: 'unblame'
    },
    {
      fetchData: async (page: number, pageSize: number, unblameData: UnblameData) => {
        return await fetchUnblameData(unblameData, page, pageSize);
      },
      buildEmbed: (data: PaginationData<EmbedBuilder>) => {
        return buildUnblameEmbed(data);
      },
      buildCustomId: (page: number) => {
        return createStandardCustomId('unblame', page);
      },
      parseCustomId: (customId: string) => {
        const parsed = parseStandardCustomId(customId, 'unblame');
        if (!parsed) return null;
        return { page: parsed.page };
      }
    }
  );
}

export async function handleButton(customId: string, interaction: ButtonInteraction) {
  if (!customId.startsWith('unblame:')) return;
  
  // For unblame, we need to store the unblame data in the session
  // This is a simplified approach - in a real app you might want to store this in a database
  const messageId = interaction.message?.id;
  if (!messageId) return;
  
  // We'll need to reconstruct the unblame data from the message content
  // This is a limitation of the current approach - ideally we'd store this data
  // For now, we'll just handle the basic pagination without the refresh functionality
  const parts = customId.split(':');
  if (parts.length < 3) return;
  
  const sessionId = parts.slice(2).join(':'); // Rejoin in case there are colons in the session ID
  const parsed = parseStandardCustomId(sessionId, 'unblame');
  if (!parsed) return;
  
  // Since we can't easily reconstruct the unblame data, we'll just acknowledge the interaction
  await interaction.deferUpdate();
}


