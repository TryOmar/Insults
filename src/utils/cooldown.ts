import { User } from 'discord.js';

// Map to store user cooldowns: userId -> commandName -> lastUsedTimestamp
const userCooldowns = new Map<string, Map<string, number>>();

// Default cooldown times in milliseconds
const DEFAULT_COOLDOWNS = {
  blame: 5000,     // 5 seconds for blame command
  unblame: 3000,   // 3 seconds for unblame command
  archive: 3000,    // 3 seconds for archive command
  revert: 5000,    // 5 seconds for revert command
  radar: 10000,    // 10 seconds for radar command (admin)
  help: 2000,      // 2 seconds for help command
  history: 3000,   // 3 seconds for history command
  detail: 2000,    // 2 seconds for detail command
  rank: 3000,      // 3 seconds for rank command
  insults: 3000,   // 3 seconds for insults command
} as const;

type CommandName = keyof typeof DEFAULT_COOLDOWNS;

/**
 * Check if a user is on cooldown for a specific command
 * @param user The Discord user
 * @param commandName The command name
 * @param customCooldown Optional custom cooldown time in milliseconds
 * @returns Object with isOnCooldown boolean and remainingTime in milliseconds
 */
export function checkCooldown(
  user: User, 
  commandName: CommandName, 
  customCooldown?: number
): { isOnCooldown: boolean; remainingTime: number } {
  const userId = user.id;
  const cooldownTime = customCooldown ?? DEFAULT_COOLDOWNS[commandName];
  const now = Date.now();
  
  // Get or create user's cooldown map
  if (!userCooldowns.has(userId)) {
    userCooldowns.set(userId, new Map());
  }
  
  const userCooldownMap = userCooldowns.get(userId)!;
  const lastUsed = userCooldownMap.get(commandName) ?? 0;
  const timeSinceLastUse = now - lastUsed;
  
  if (timeSinceLastUse < cooldownTime) {
    return {
      isOnCooldown: true,
      remainingTime: cooldownTime - timeSinceLastUse
    };
  }
  
  return {
    isOnCooldown: false,
    remainingTime: 0
  };
}

/**
 * Set a user's cooldown for a specific command
 * @param user The Discord user
 * @param commandName The command name
 */
export function setCooldown(user: User, commandName: CommandName): void {
  const userId = user.id;
  const now = Date.now();
  
  // Get or create user's cooldown map
  if (!userCooldowns.has(userId)) {
    userCooldowns.set(userId, new Map());
  }
  
  const userCooldownMap = userCooldowns.get(userId)!;
  userCooldownMap.set(commandName, now);
}

/**
 * Format remaining cooldown time into a human-readable string
 * @param remainingTime Time in milliseconds
 * @returns Formatted string like "2.5 seconds" or "1 minute"
 */
export function formatCooldownTime(remainingTime: number): string {
  const seconds = Math.ceil(remainingTime / 1000);
  
  if (seconds < 60) {
    return `${seconds} second${seconds === 1 ? '' : 's'}`;
  }
  
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  
  if (minutes === 1 && remainingSeconds === 0) {
    return '1 minute';
  }
  
  if (remainingSeconds === 0) {
    return `${minutes} minutes`;
  }
  
  return `${minutes} minute${minutes === 1 ? '' : 's'} ${remainingSeconds} second${remainingSeconds === 1 ? '' : 's'}`;
}

/**
 * Clear cooldowns for a specific user (useful for testing or admin commands)
 * @param user The Discord user
 * @param commandName Optional specific command to clear, or all commands if not provided
 */
export function clearCooldown(user: User, commandName?: CommandName): void {
  const userId = user.id;
  
  if (!userCooldowns.has(userId)) {
    return;
  }
  
  const userCooldownMap = userCooldowns.get(userId)!;
  
  if (commandName) {
    userCooldownMap.delete(commandName);
  } else {
    userCooldownMap.clear();
  }
  
  // Clean up empty user maps
  if (userCooldownMap.size === 0) {
    userCooldowns.delete(userId);
  }
}

/**
 * Get cooldown information for a user (useful for debugging)
 * @param user The Discord user
 * @returns Map of command names to last used timestamps
 */
export function getUserCooldowns(user: User): Map<string, number> {
  const userId = user.id;
  return userCooldowns.get(userId) ?? new Map();
}
