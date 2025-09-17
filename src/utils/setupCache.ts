import { prisma } from '../database/client.js';

interface SetupData {
  guildId: string;
  blamerRoleId: string | null;
  frozenRoleId: string | null;
  insultsChannelId: string | null;
  monitorChannelId: string | null;
  insulterRoleId: string | null;
  insulterDays: number;
  radarMode: string;
}

class SetupCache {
  private cache = new Map<string, SetupData>();

  /**
   * Get setup data for a guild with lazy loading
   * Returns cached data if available, otherwise fetches from DB and caches it
   */
  async getSetup(guildId: string): Promise<SetupData | null> {
    // Check if already cached
    const cached = this.cache.get(guildId);
    if (cached) {
      return cached;
    }

    // Fetch from database
    const setup = await prisma.setup.findUnique({
      where: { guildId },
      select: {
        guildId: true,
        blamerRoleId: true,
        frozenRoleId: true,
        insultsChannelId: true,
        monitorChannelId: true,
        insulterRoleId: true,
        insulterDays: true,
        radarMode: true
      }
    });

    if (!setup) {
      return null;
    }

    // Cache the result
    this.cache.set(guildId, setup);
    return setup;
  }

  /**
   * Update cache with new setup data (used after upsert operations)
   * This ensures cache stays in sync with database changes
   */
  updateCache(guildId: string, setupData: SetupData): void {
    this.cache.set(guildId, setupData);
  }

  /**
   * Invalidate cache for a guild (call when setup is updated)
   * Forces next getSetup call to fetch from database
   */
  invalidate(guildId: string): void {
    this.cache.delete(guildId);
  }

  /**
   * Clear all cache entries
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Get cache statistics for debugging
   */
  getStats(): { size: number; entries: string[] } {
    return {
      size: this.cache.size,
      entries: Array.from(this.cache.keys())
    };
  }
}

// Export singleton instance
export const setupCache = new SetupCache();
