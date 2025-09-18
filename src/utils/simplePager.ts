import { ActionRowBuilder, ButtonBuilder, ButtonInteraction, ButtonStyle, ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';

type Session = {
  pages: EmbedBuilder[][];
  currentPage: number;
  embedGenerator?: () => EmbedBuilder[][];
};

export function createSimplePager(prefix: string) {
  const sessions = new Map<string, Session>();

  function buildButtons(page: number, total: number) {
    const row = new ActionRowBuilder<ButtonBuilder>();
    row.addComponents(
      new ButtonBuilder().setCustomId(`${prefix}:first`).setLabel('⏮').setStyle(ButtonStyle.Secondary).setDisabled(page === 1),
      new ButtonBuilder().setCustomId(`${prefix}:prev`).setLabel('◀').setStyle(ButtonStyle.Secondary).setDisabled(page === 1),
      new ButtonBuilder().setCustomId(`${prefix}:next`).setLabel('▶').setStyle(ButtonStyle.Secondary).setDisabled(page === total),
      new ButtonBuilder().setCustomId(`${prefix}:last`).setLabel('⏭').setStyle(ButtonStyle.Secondary).setDisabled(page === total),
    );
    return [row];
  }

  return {
    async send(
      interaction: ChatInputCommandInteraction,
      pages: EmbedBuilder[][],
      initialPage: number = 1,
      embedGenerator?: () => EmbedBuilder[][]
    ) {
      const page = Math.max(1, Math.min(initialPage, pages.length));
      
      // Check if interaction has been deferred or replied to
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ embeds: pages[page - 1], components: buildButtons(page, pages.length) });
      } else {
        await interaction.reply({ embeds: pages[page - 1], components: buildButtons(page, pages.length) });
      }
      
      const sent = await interaction.fetchReply();
      sessions.set(sent.id, { pages, currentPage: page, embedGenerator });
      setTimeout(() => sessions.delete(sent.id), 15 * 60 * 1000);
    },

    async handleButton(customId: string, interaction: ButtonInteraction) {
      if (!customId.startsWith(`${prefix}:`)) return;
      const action = customId.split(':')[1];
      const messageId = interaction.message?.id;
      if (!messageId) return;
      const session = sessions.get(messageId);
      if (!session) return;

      // Regenerate embeds if generator is provided (for dynamic timestamps)
      if (session.embedGenerator) {
        session.pages = session.embedGenerator();
      }

      const totalPages = session.pages.length;
      let newPage = session.currentPage;
      if (action === 'first') newPage = 1;
      else if (action === 'prev') newPage = Math.max(1, session.currentPage - 1);
      else if (action === 'next') newPage = Math.min(totalPages, session.currentPage + 1);
      else if (action === 'last') newPage = totalPages;

      session.currentPage = newPage;
      const row = buildButtons(newPage, totalPages);
      await interaction.update({ embeds: session.pages[newPage - 1], components: row });
    }
  };
}


