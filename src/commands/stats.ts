// Updated stats.ts - Optimized version
import { ChatInputCommandInteraction, SlashCommandBuilder, EmbedBuilder, userMention, MessageFlags } from 'discord.js';
import { prisma } from '../database/client.js';
import { renderTable } from '../utils/tableRenderer.js';

// Helper function to create ultra-short timestamps
function getShortTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);
  const diffWeeks = Math.floor(diffDays / 7);
  const diffMonths = Math.floor(diffDays / 30);
  const diffYears = Math.floor(diffDays / 365);

  if (diffYears > 0) return `${diffYears}y`;
  if (diffMonths > 0) return `${diffMonths}mo`;
  if (diffWeeks > 0) return `${diffWeeks}w`;
  if (diffDays > 0) return `${diffDays}d`;
  if (diffHours > 0) return `${diffHours}h`;
  if (diffMinutes > 0) return `${diffMinutes}m`;
  if (diffSeconds > 0) return `${diffSeconds}s`;
  return 'now';
}

export const data = new SlashCommandBuilder()
  .setName('stats')
  .setDescription('Show recent insult entries for a user')
  .addUserOption((opt) =>
    opt.setName('user').setDescription('The user to inspect').setRequired(true)
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  const guildId = interaction.guildId;
  if (!guildId) {
    await interaction.reply({ content: 'This command can only be used in a server.', flags: MessageFlags.Ephemeral });
    return;
  }
  
  const target = interaction.options.getUser('user', true);

  // Fetch entries with blamer information
  const entries = await prisma.insult.findMany({
    where: { guildId, userId: target.id },
    orderBy: { createdAt: 'desc' },
    take: 10
    // Remove the include for now - adjust based on your actual schema
  });

  if (entries.length === 0) {
    await interaction.reply({ 
      content: `📊 No insults recorded for ${userMention(target.id)}.`,
      flags: MessageFlags.Ephemeral 
    });
    return;
  }

  // Prepare table data
  const headers = ['ID', 'Insult', 'Note', 'Blamer', 'When'];
  
  // Get unique blamer IDs and fetch their usernames
  const userIdToUsername = new Map<string, string>();
  const uniqueBlamerIds = Array.from(new Set(
    entries.map(e => e.blamerId).filter(Boolean)
  ));
  
  if (uniqueBlamerIds.length > 0) {
    const users = await prisma.user.findMany({
      where: { id: { in: uniqueBlamerIds } },
      select: { id: true, username: true }
    });
    users.forEach(u => userIdToUsername.set(u.id, u.username));
  }

  // Create table rows with optimized content
  const rows = entries.map((entry) => {
    // Get blamer name with fallback
    const blamerName = entry.blamerId 
      ? `@${userIdToUsername.get(entry.blamerId) || 'Unknown'}` 
      : '—';
    
    return [
      entry.id.toString(),
      entry.insult, // Let renderTable handle truncation
      entry.note || '—',
      blamerName, // Let renderTable handle truncation
      getShortTime(entry.createdAt) // Use custom short timestamp
    ];
  });

  // Generate the table
  const table = renderTable(headers, rows);

  // Create and send embed
  const embed = new EmbedBuilder()
    .setTitle(`📊 Insult Stats for ${target.username}`)
    .setDescription(table)
    .setColor(0xff6b6b) // Light red color
    .setFooter({ 
      text: `Showing ${entries.length} recent entries • Use /detail <ID> for more info` 
    })
    .setTimestamp();

  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}