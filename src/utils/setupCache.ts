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
  cachedAt: number;
}

class SetupCache {
  private cache = new Map<string, SetupData>();
  private readonly TTL = 5 * 60 * 1000; // 5 minutes

  async getSetup(guildId: string): Promise<SetupData | null> {
    const cached = this.cache.get(guildId);
    const now = Date.now();

    // Return cached data if it's still valid
    if (cached && (now - cached.cachedAt) < this.TTL) {
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
    const setupData: SetupData = {
      ...setup,
      cachedAt: now
    };
    this.cache.set(guildId, setupData);

    return setupData;
  }

  // Invalidate cache for a guild (call when setup is updated)
  invalidate(guildId: string): void {
    this.cache.delete(guildId);
  }

  // Clear all cache
  clear(): void {
    this.cache.clear();
  }

  // Get cache stats for debugging
  getStats(): { size: number; entries: string[] } {
    return {
      size: this.cache.size,
      entries: Array.from(this.cache.keys())
    };
  }
}

// Export singleton instance
export const setupCache = new SetupCache();
