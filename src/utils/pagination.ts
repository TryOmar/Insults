import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ButtonInteraction, ChatInputCommandInteraction, EmbedBuilder, MessageFlags } from 'discord.js';
import { isInteractionExpired, isDiscordAPIError, isInteractionInvalidError } from './interactionValidation.js';

export interface PaginationConfig {
  pageSize: number;
  commandName: string;
  customIdPrefix: string;
  ephemeral?: boolean; // Whether responses should be ephemeral (default: true)
}

export interface PaginationData<T> {
  items: T[];
  totalCount: number;
  currentPage: number;
  totalPages: number;
}

export interface PaginationCallbacks<T, D = PaginationData<T>> {
  fetchData: (page: number, pageSize: number, ...args: any[]) => Promise<D>;
  buildEmbed: (data: D, ...args: any[]) => EmbedBuilder;
  buildCustomId: (page: number, ...args: any[]) => string;
  parseCustomId: (customId: string) => { page: number; [key: string]: any } | null;
}

export class PaginationManager<T, D = PaginationData<T>> {
  private config: PaginationConfig;
  private callbacks: PaginationCallbacks<T, D>;

  constructor(config: PaginationConfig, callbacks: PaginationCallbacks<T, D>) {
    this.config = config;
    this.callbacks = callbacks;
  }

  buildPaginationButtons(page: number, totalPages: number, ...args: any[]): ActionRowBuilder<ButtonBuilder>[] {
    if (totalPages <= 1) return [];

    const row = new ActionRowBuilder<ButtonBuilder>();
    
    // Create a unique identifier for this pagination session
    const sessionId = this.callbacks.buildCustomId(page, ...args);

    // First page button (<<)
    const firstButton = new ButtonBuilder()
      .setCustomId(`${this.config.customIdPrefix}:first:${sessionId}`)
      .setEmoji('⏮️')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(page === 1);

    // Previous page button (<)
    const prevButton = new ButtonBuilder()
      .setCustomId(`${this.config.customIdPrefix}:prev:${sessionId}`)
      .setEmoji('◀️')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(page === 1);

    // Next page button (>)
    const nextButton = new ButtonBuilder()
      .setCustomId(`${this.config.customIdPrefix}:next:${sessionId}`)
      .setEmoji('▶️')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(page === totalPages);

    // Last page button (>>)
    const lastButton = new ButtonBuilder()
      .setCustomId(`${this.config.customIdPrefix}:last:${sessionId}`)
      .setEmoji('⏭️')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(page === totalPages);

    // Refresh button (re-fetches current page)
    const refreshButton = new ButtonBuilder()
      .setCustomId(`${this.config.customIdPrefix}:refresh:${sessionId}`)
      .setEmoji('🔄')
      .setStyle(ButtonStyle.Primary);

    row.addComponents(firstButton, prevButton, nextButton, lastButton, refreshButton);
    return [row];
  }

  async handleInitialCommand(interaction: ChatInputCommandInteraction, ...args: any[]): Promise<void> {
    const guildId = interaction.guildId;
    if (!guildId) {
      const replyOptions: any = { 
        content: 'This command can only be used in a server.'
      };
      
      // Only add ephemeral flag if configured to be ephemeral (default: true)
      if (this.config.ephemeral !== false) {
        replyOptions.flags = MessageFlags.Ephemeral;
      }
      
      await interaction.reply(replyOptions);
      return;
    }

    await this.respondWithPage(interaction, 1, true, ...args);
  }

  async respondWithPage(
    interaction: ChatInputCommandInteraction | ButtonInteraction, 
    page: number, 
    isInitial: boolean = false,
    ...args: any[]
  ): Promise<void> {
    // Check if interaction is still valid (not expired)
    if (isInteractionExpired(interaction)) {
      console.log(`Interaction ${interaction.id} has expired, skipping response`);
      return;
    }

    try {
      const data = await this.callbacks.fetchData(page, this.config.pageSize, ...args);
      const embed = this.callbacks.buildEmbed(data, ...args);
      const components = this.buildPaginationButtons(page, (data as any).totalPages, ...args);

      if (isInitial) {
        if (interaction.replied || interaction.deferred) {
          await interaction.editReply({ 
            embeds: [embed], 
            components
          });
        } else {
          const replyOptions: any = { 
            embeds: [embed], 
            components
          };
          
          // Only add ephemeral flag if configured to be ephemeral (default: true)
          if (this.config.ephemeral !== false) {
            replyOptions.flags = MessageFlags.Ephemeral;
          }
          
          await interaction.reply(replyOptions);
        }
      } else {
        if ('update' in interaction) {
          await interaction.update({ embeds: [embed], components });
        } else if ('editReply' in interaction) {
          await interaction.editReply({ embeds: [embed], components });
        }
      }
    } catch (error) {
      console.error(`Error in pagination for ${this.config.commandName}:`, error);
      
      // Check if this is a Discord API error indicating the interaction is invalid
      if (isDiscordAPIError(error) && isInteractionInvalidError(error)) {
        console.log(`Interaction ${interaction.id} is invalid (expired or already acknowledged), skipping error response`);
        return;
      }
      
      // Don't try to respond if the interaction is already acknowledged
      if (interaction.replied || interaction.deferred) {
        console.log('Interaction already acknowledged, skipping error response');
        return;
      }
      
      // Check if interaction is still valid before trying to respond with error
      if (isInteractionExpired(interaction)) {
        console.log(`Interaction ${interaction.id} has expired, skipping error response`);
        return;
      }
      
      const errorEmbed = new EmbedBuilder()
        .setTitle('❌ Error')
        .setDescription('An error occurred while fetching data. Please try again.')
        .setColor(0xFF0000);

      if (isInitial) {
        try {
          const errorReplyOptions: any = { 
            embeds: [errorEmbed]
          };
          
          // Only add ephemeral flag if configured to be ephemeral (default: true)
          if (this.config.ephemeral !== false) {
            errorReplyOptions.flags = MessageFlags.Ephemeral;
          }
          
          await interaction.reply(errorReplyOptions);
        } catch (replyError) {
          console.log('Failed to reply with error:', replyError);
        }
      } else {
        try {
          if ('update' in interaction) {
            await interaction.update({ embeds: [errorEmbed], components: [] });
          } else if ('editReply' in interaction) {
            await interaction.editReply({ embeds: [errorEmbed], components: [] });
          }
        } catch (updateError) {
          console.log('Failed to update with error:', updateError);
        }
      }
    }
  }

  async handleButton(customId: string, interaction: ButtonInteraction, ...args: any[]): Promise<boolean> {
    if (!customId.startsWith(this.config.customIdPrefix)) {
      return false;
    }

    // Parse the new button format: prefix:action:sessionId
    const parts = customId.split(':');
    if (parts.length < 3) {
      return false;
    }

    const [prefix, action, sessionId] = parts;
    
    // Parse the session ID to get the current page and arguments
    const parsed = this.callbacks.parseCustomId(sessionId);
    if (!parsed) {
      return false;
    }

    let newPage = parsed.page;

    switch (action) {
      case 'first':
        newPage = 1;
        break;
      case 'prev':
        newPage = Math.max(1, parsed.page - 1);
        break;
      case 'next':
        // We need to get the total pages to know the max
        const data = await this.callbacks.fetchData(parsed.page, this.config.pageSize, ...args);
        newPage = Math.min((data as any).totalPages, parsed.page + 1);
        break;
      case 'last':
        // We need to get the total pages
        const data2 = await this.callbacks.fetchData(parsed.page, this.config.pageSize, ...args);
        newPage = (data2 as any).totalPages;
        break;
      case 'refresh':
        newPage = parsed.page; // Stay on current page but refresh data
        break;
      default:
        return false;
    }

    // For next and last actions, we need to pass the correct arguments
    // The args should come from the parsed session data, not the function parameters
    const sessionArgs = this.extractArgsFromSession(parsed);
    await this.respondWithPage(interaction, newPage, false, ...sessionArgs);
    return true;
  }

  private extractArgsFromSession(parsed: any): any[] {
    // Extract arguments from the parsed session data
    // This is a helper method that each command can override if needed
    const args: any[] = [];
    
    // Add all properties except 'page' as arguments
    for (const [key, value] of Object.entries(parsed)) {
      if (key !== 'page') {
        args.push(value);
      }
    }
    
    return args;
  }

}

// Helper function to create a standard custom ID format
export function createStandardCustomId(prefix: string, page: number, ...params: (string | number)[]): string {
  const paramString = params.length > 0 ? `:${params.join(':')}` : '';
  return `${prefix}:${page}${paramString}`;
}

// Helper function to parse a standard custom ID format
export function parseStandardCustomId(customId: string, prefix: string): { page: number; params: string[] } | null {
  const pattern = new RegExp(`^${prefix}:(\\d+)(?::(.+))?$`);
  const match = customId.match(pattern);
  
  if (!match) return null;
  
  const page = parseInt(match[1], 10);
  const params = match[2] ? match[2].split(':') : [];
  
  return { page, params };
}
