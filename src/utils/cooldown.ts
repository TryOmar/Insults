import { User } from 'discord.js';

// ============================================================================
// CONFIGURATION - All spam prevention settings in one place
// ============================================================================

/**
 * Base cooldown times in milliseconds (before progressive punishment)
 * These are the normal cooldowns for each command
 */
export const BASE_COOLDOWNS = {
  blame: 5000,     // 5 seconds - creates records
  unblame: 3000,   // 3 seconds - modifies records
  archive: 3000,   // 3 seconds - viewing command
  revert: 5000,    // 5 seconds - modifies records
  radar: 10000,    // 10 seconds - admin command
  help: 2000,      // 2 seconds - simple help
  history: 3000,   // 3 seconds - viewing command
  detail: 2000,    // 2 seconds - viewing command
  rank: 3000,      // 3 seconds - viewing command
  insults: 3000,   // 3 seconds - viewing command
} as const;

/**
 * Burst detection settings - prevents rapid command usage
 * maxCommands: Maximum commands allowed in the time window
 * timeWindow: Time window in milliseconds
 */
export const BURST_LIMITS = {
  blame: { maxCommands: 3, timeWindow: 10000 },     // 3 commands per 10 seconds
  unblame: { maxCommands: 2, timeWindow: 10000 },   // 2 commands per 10 seconds
  archive: { maxCommands: 5, timeWindow: 10000 },   // 5 commands per 10 seconds
  revert: { maxCommands: 2, timeWindow: 10000 },     // 2 commands per 10 seconds
  radar: { maxCommands: 1, timeWindow: 15000 },     // 1 command per 15 seconds (admin)
  help: { maxCommands: 8, timeWindow: 10000 },       // 8 commands per 10 seconds
  history: { maxCommands: 5, timeWindow: 10000 },   // 5 commands per 10 seconds
  detail: { maxCommands: 8, timeWindow: 10000 },    // 8 commands per 10 seconds
  rank: { maxCommands: 5, timeWindow: 10000 },     // 5 commands per 10 seconds
  insults: { maxCommands: 5, timeWindow: 10000 },  // 5 commands per 10 seconds
} as const;

/**
 * Progressive punishment settings - escalates penalties for repeat offenders
 * violationResetTime: Time in milliseconds before violations reset (5 minutes)
 * punishments: Array of punishment levels
 */
export const PROGRESSIVE_PUNISHMENT = {
  violationResetTime: 300000,    // 5 minutes without violations resets counter
  punishments: [
    { violations: 1, multiplier: 1.5 },    // 1st violation: 1.5x cooldown
    { violations: 2, multiplier: 2.0 },    // 2nd violation: 2x cooldown  
    { violations: 3, multiplier: 3.0 },    // 3rd violation: 3x cooldown
    { violations: 4, multiplier: 5.0 },    // 4th violation: 5x cooldown
    { violations: 5, blockTime: 60000 },   // 5th violation: 1 minute block
  ]
} as const;

// ============================================================================
// TYPES AND DATA STRUCTURES
// ============================================================================

export type CommandName = keyof typeof BASE_COOLDOWNS;

/**
 * Enhanced user tracking with burst detection and progressive punishment
 */
interface UserCommandHistory {
  timestamps: number[];           // Recent command timestamps
  violations: number;             // Number of violations
  lastViolationTime: number;      // When the last violation occurred
  isBlocked: boolean;             // Whether user is temporarily blocked
  blockUntil: number;             // When the block expires
}

/**
 * Map to store enhanced user data: userId -> commandName -> UserCommandHistory
 */
const userCommandData = new Map<string, Map<string, UserCommandHistory>>();

// ============================================================================
// CORE FUNCTIONS - Enhanced spam prevention logic
// ============================================================================

/**
 * Enhanced cooldown check with burst detection and progressive punishment
 * @param user The Discord user
 * @param commandName The command name
 * @returns Object with check result and details
 */
export function checkEnhancedCooldown(
  user: User, 
  commandName: CommandName
): { 
  allowed: boolean; 
  reason?: string; 
  remainingTime?: number;
  violationCount?: number;
} {
  const userId = user.id;
  const now = Date.now();
  
  // Get or create user's command data
  if (!userCommandData.has(userId)) {
    userCommandData.set(userId, new Map());
  }
  
  const userCommandMap = userCommandData.get(userId)!;
  let commandData = userCommandMap.get(commandName);
  
  // Initialize command data if it doesn't exist
  if (!commandData) {
    commandData = {
      timestamps: [],
      violations: 0,
      lastViolationTime: 0,
      isBlocked: false,
      blockUntil: 0
    };
    userCommandMap.set(commandName, commandData);
  }
  
  // Check if user is currently blocked
  if (commandData.isBlocked && now < commandData.blockUntil) {
    return {
      allowed: false,
      reason: 'blocked',
      remainingTime: commandData.blockUntil - now,
      violationCount: commandData.violations
    };
  }
  
  // Clear expired block
  if (commandData.isBlocked && now >= commandData.blockUntil) {
    commandData.isBlocked = false;
    commandData.blockUntil = 0;
  }
  
  // Clean old timestamps (older than the time window)
  const burstLimit = BURST_LIMITS[commandName];
  const cutoffTime = now - burstLimit.timeWindow;
  commandData.timestamps = commandData.timestamps.filter(timestamp => timestamp > cutoffTime);
  
  // Check burst limit
  if (commandData.timestamps.length >= burstLimit.maxCommands) {
    // Violation detected - increment counter
    commandData.violations++;
    commandData.lastViolationTime = now;
    
    // Apply progressive punishment
    const punishment = getProgressivePunishment(commandData.violations);
    if (punishment.blockTime) {
      // Block the user
      commandData.isBlocked = true;
      commandData.blockUntil = now + punishment.blockTime;
      return {
        allowed: false,
        reason: 'blocked',
        remainingTime: punishment.blockTime,
        violationCount: commandData.violations
      };
    } else {
      // Apply cooldown multiplier
      const baseCooldown = BASE_COOLDOWNS[commandName];
      const enhancedCooldown = baseCooldown * punishment.multiplier;
      const oldestTimestamp = Math.min(...commandData.timestamps);
      const remainingTime = (oldestTimestamp + burstLimit.timeWindow) - now;
      
      return {
        allowed: false,
        reason: 'burst_limit',
        remainingTime: Math.max(remainingTime, enhancedCooldown),
        violationCount: commandData.violations
      };
    }
  }
  
  // Check if enough time has passed to reset violations
  if (commandData.violations > 0 && (now - commandData.lastViolationTime) > PROGRESSIVE_PUNISHMENT.violationResetTime) {
    commandData.violations = 0;
  }
  
  // Check regular cooldown (with progressive punishment multiplier)
  const punishment = getProgressivePunishment(commandData.violations);
  const baseCooldown = BASE_COOLDOWNS[commandName];
  const enhancedCooldown = baseCooldown * punishment.multiplier;
  
  if (commandData.timestamps.length > 0) {
    const lastCommandTime = Math.max(...commandData.timestamps);
    const timeSinceLastCommand = now - lastCommandTime;
    
    if (timeSinceLastCommand < enhancedCooldown) {
      return {
        allowed: false,
        reason: 'cooldown',
        remainingTime: enhancedCooldown - timeSinceLastCommand,
        violationCount: commandData.violations
      };
    }
  }
  
  return {
    allowed: true,
    violationCount: commandData.violations
  };
}

/**
 * Get progressive punishment based on violation count
 */
function getProgressivePunishment(violations: number): { multiplier: number; blockTime?: number } {
  for (const punishment of PROGRESSIVE_PUNISHMENT.punishments) {
    if (violations >= punishment.violations) {
      if ('blockTime' in punishment) {
        return { multiplier: 1, blockTime: punishment.blockTime };
      } else {
        return { multiplier: punishment.multiplier };
      }
    }
  }
  return { multiplier: 1 };
}

/**
 * Record a command usage (replaces setCooldown)
 * @param user The Discord user
 * @param commandName The command name
 */
export function recordCommand(user: User, commandName: CommandName): void {
  const userId = user.id;
  const now = Date.now();
  
  // Get or create user's command data
  if (!userCommandData.has(userId)) {
    userCommandData.set(userId, new Map());
  }
  
  const userCommandMap = userCommandData.get(userId)!;
  let commandData = userCommandMap.get(commandName);
  
  // Initialize command data if it doesn't exist
  if (!commandData) {
    commandData = {
      timestamps: [],
      violations: 0,
      lastViolationTime: 0,
      isBlocked: false,
      blockUntil: 0
    };
    userCommandMap.set(commandName, commandData);
  }
  
  // Add current timestamp
  commandData.timestamps.push(now);
  
  // Clean old timestamps (keep only recent ones)
  const burstLimit = BURST_LIMITS[commandName];
  const cutoffTime = now - burstLimit.timeWindow;
  commandData.timestamps = commandData.timestamps.filter(timestamp => timestamp > cutoffTime);
}

// ============================================================================
// UTILITY FUNCTIONS - Helper functions for formatting and management
// ============================================================================

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
 * Get user-friendly message for cooldown violations
 * @param reason The violation reason
 * @param remainingTime Remaining time in milliseconds
 * @param violationCount Number of violations
 * @returns User-friendly message
 */
export function getCooldownMessage(reason: string, remainingTime: number, violationCount: number): string {
  const timeStr = formatCooldownTime(remainingTime);
  
  switch (reason) {
    case 'burst_limit':
      return `🚫 **Too many commands!** Please wait ${timeStr} before using this command again. (Violation #${violationCount})`;
    case 'blocked':
      return `⛔ **Temporarily blocked!** You've been blocked for ${timeStr} due to repeated violations. (Violation #${violationCount})`;
    case 'cooldown':
      return `⏰ **Please wait** ${timeStr} before using this command again.`;
    default:
      return `⏰ Please wait ${timeStr} before using this command again.`;
  }
}

/**
 * Clear command data for a specific user (useful for testing or admin commands)
 * @param user The Discord user
 * @param commandName Optional specific command to clear, or all commands if not provided
 */
export function clearUserData(user: User, commandName?: CommandName): void {
  const userId = user.id;
  
  if (!userCommandData.has(userId)) {
    return;
  }
  
  const userCommandMap = userCommandData.get(userId)!;
  
  if (commandName) {
    userCommandMap.delete(commandName);
  } else {
    userCommandMap.clear();
  }
  
  // Clean up empty user maps
  if (userCommandMap.size === 0) {
    userCommandData.delete(userId);
  }
}

/**
 * Get command data for a user (useful for debugging)
 * @param user The Discord user
 * @returns Map of command names to UserCommandHistory
 */
export function getUserCommandData(user: User): Map<string, UserCommandHistory> {
  const userId = user.id;
  return userCommandData.get(userId) ?? new Map();
}

// ============================================================================
// LEGACY FUNCTIONS - Backward compatibility (deprecated)
// ============================================================================

/**
 * Legacy function for backward compatibility (deprecated)
 * @deprecated Use checkEnhancedCooldown instead
 */
export function checkCooldown(user: User, commandName: CommandName): { isOnCooldown: boolean; remainingTime: number } {
  const result = checkEnhancedCooldown(user, commandName);
  return {
    isOnCooldown: !result.allowed,
    remainingTime: result.remainingTime ?? 0
  };
}

/**
 * Legacy function for backward compatibility (deprecated)
 * @deprecated Use recordCommand instead
 */
export function setCooldown(user: User, commandName: CommandName): void {
  recordCommand(user, commandName);
}
