import { prisma } from '../database/client.js';
import { withRetry } from '../database/retry.js';
import { setupCache } from '../utils/setupCache.js';

/**
 * Service for managing guild setup and configuration
 * Handles automatic guild detection and database setup
 */
export class GuildSetupService {
  private static instance: GuildSetupService;

  private constructor() {}

  /**
   * Get singleton instance of GuildSetupService
   */
  public static getInstance(): GuildSetupService {
    if (!GuildSetupService.instance) {
      GuildSetupService.instance = new GuildSetupService();
    }
    return GuildSetupService.instance;
  }

  /**
   * Ensure a guild has a setup record in the database
   * Creates one with radar enabled if it doesn't exist
   * @param guildId - The Discord guild ID
   * @param guildName - Optional guild name for logging
   * @returns Promise<boolean> - true if setup was successful, false otherwise
   */
  public async ensureGuildSetup(guildId: string, guildName?: string): Promise<boolean> {
    try {
      return await withRetry(async () => {
        // Ensure a setup row exists using upsert to avoid separate read/write
        await prisma.setup.upsert({
          where: { guildId },
          update: {},
          create: { guildId, radarMode: 'blame' } as any,
        });

        if (guildName) {
          console.log(`ℹ️ Setup ensured for guild: ${guildName} (${guildId})`);
        }
        return true;
      }, `ensureGuildSetup for ${guildName || guildId}`);
      
    } catch (error) {
      if (guildName) {
        console.warn(`⚠️ Failed to setup guild ${guildName} (${guildId}):`, error);
      }
      return false;
    }
  }

  /**
   * Get radar mode for a guild
   * @param guildId - The Discord guild ID
   * @returns Promise<string> - radar mode ("off", "blame", "delete", "both")
   */
  public async getRadarMode(guildId: string): Promise<string> {
    try {
      const setup = await setupCache.getSetup(guildId);
      return setup?.radarMode ?? 'off';
    } catch (error) {
      console.warn(`⚠️ Failed to check radar mode for guild ${guildId}:`, error);
      return 'off';
    }
  }

  /**
   * Check if radar is enabled for a guild (for backward compatibility)
   * @param guildId - The Discord guild ID
   * @returns Promise<boolean> - true if radar is enabled, false otherwise
   */
  public async isRadarEnabled(guildId: string): Promise<boolean> {
    const mode = await this.getRadarMode(guildId);
    return mode !== 'off';
  }

  /**
   * Setup all guilds that the bot is currently in
   * @param guilds - Map of guild IDs to guild objects
   * @returns Promise<number> - Number of guilds successfully set up
   */
  public async setupAllGuilds(guilds: Map<string, any>): Promise<number> {
    console.log('🔍 Auto-detecting guilds and setting up database records...');
    console.log(`Found ${guilds.size} guild(s)`);
    
    let successCount = 0;
    
    for (const [guildId, guild] of guilds) {
      const success = await this.ensureGuildSetup(guildId, guild.name);
      if (success) {
        successCount++;
      }
    }
    
    console.log(`🎉 Guild auto-detection completed (${successCount}/${guilds.size} successful)`);
    return successCount;
  }
}

// Export singleton instance for convenience
export const guildSetupService = GuildSetupService.getInstance();
