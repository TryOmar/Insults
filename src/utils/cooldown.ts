import { User } from 'discord.js';

// ============================================================================
// 🔧 ANTI-SPAM CONFIGURATION
// ============================================================================

export const BASE_DELAY = 3000;      // Base cooldown: 3s
export const VIOLATION_WINDOW = 10000; // 10-second window
export const MAX_VIOLATIONS = 3;     // 3 commands in window → violation
export const MAX_LEVEL = 10;         // Max escalation level
export const LEVEL_RESET_TIME = 300000; // 5 minutes before level starts decreasing
export const LEVEL_DECAY_INTERVAL = 60000; // 1 minute between level decreases

// ============================================================================
// 💬 MESSAGE CATEGORIES
// ============================================================================

const MESSAGE_CATEGORIES = {
  cooldown: [
    "Please wait `{time}` before using another command.",
    "Command on cooldown. Try again in `{time}`.",
    "Hold on! Wait `{time}` before your next attempt.",
    "Rate limited. Please wait `{time}`.",
    "Too soon! Wait `{time}` before retrying."
  ],
  
  violation: [
    "Too many commands! Wait `{time}` before trying again.",
    "Command spam detected. Please wait `{time}`.",
    "Slow down! Try again in `{time}`.",
    "Rate limit exceeded. Wait `{time}` before retrying.",
    "You're going too fast. Please wait `{time}`."
  ],
  
  blocked: [
    "You're blocked from using commands for `{time}` due to excessive spam.",
    "Temporary block active. Wait `{time}` before trying again.",
    "Command access blocked for `{time}` due to violations.",
    "You've been temporarily blocked for `{time}` due to spam.",
    "You're blocked for `{time}`. Please wait before trying again."
  ]
};

// ============================================================================
// 📊 DATA STRUCTURES
// ============================================================================

interface UserData {
  timestamps: number[];
  violationLevel: number;
  nextAllowedTime: number;
  isMaxLevel: boolean;
  lastViolationTime: number; // When the last violation occurred
  lastLevelDecrease: number; // When the level was last decreased
}

const userData = new Map<string, UserData>();

// ============================================================================
// 🚀 CORE COOLDOWN LOGIC (FIXED)
// ============================================================================

export function checkCooldown(user: User): 
  | { allowed: true }
  | { allowed: false; reason: 'cooldown' | 'violation' | 'blocked'; remaining: number } {
  const now = Date.now();
  
  // Get or create user data
  let data = userData.get(user.id);
  if (!data) {
    data = { 
      timestamps: [], 
      violationLevel: 1, 
      nextAllowedTime: 0, 
      isMaxLevel: false,
      lastViolationTime: 0,
      lastLevelDecrease: 0
    };
    userData.set(user.id, data);
  }

  // Check for level decay (gradual reset over time)
  if (data.violationLevel > 1) {
    const timeSinceLastViolation = now - data.lastViolationTime;
    const timeSinceLastDecrease = now - data.lastLevelDecrease;
    
    // If enough time has passed since last violation, start decreasing levels
    if (timeSinceLastViolation >= LEVEL_RESET_TIME && timeSinceLastDecrease >= LEVEL_DECAY_INTERVAL) {
      data.violationLevel = Math.max(1, data.violationLevel - 1);
      data.lastLevelDecrease = now;
      
      // If we're no longer at max level, reset the flag
      if (data.violationLevel < MAX_LEVEL) {
        data.isMaxLevel = false;
      }
    }
  }

  // Check if user is in cooldown
  if (now < data.nextAllowedTime) {
    // If user is already at max level, don't increase duration further
    if (data.isMaxLevel) {
      return {
        allowed: false,
        reason: 'blocked',
        remaining: data.nextAllowedTime - now
      };
    }
    
    // User is spamming during cooldown - increase violation level
    data.violationLevel = Math.min(data.violationLevel + 1, MAX_LEVEL);
    data.lastViolationTime = now; // Update last violation time
    
    // Check if we've reached max level
    if (data.violationLevel >= MAX_LEVEL) {
      data.isMaxLevel = true;
    }
    
    // Calculate new delay with exponential growth
    const newDelay = BASE_DELAY * Math.pow(2, data.violationLevel - 1);
    
    // Add new delay on top of existing one
    data.nextAllowedTime += newDelay;
    
    return {
      allowed: false,
      reason: data.violationLevel >= MAX_LEVEL ? 'blocked' : 'cooldown',
      remaining: data.nextAllowedTime - now
    };
  }

  // If cooldown has expired, reset the max level flag if needed
  if (data.isMaxLevel && now >= data.nextAllowedTime) {
    data.isMaxLevel = false;
    // Don't reset violation level here - let it decay naturally over time
  }

  // Clean old timestamps (keep only those from last 10 seconds)
  data.timestamps = data.timestamps.filter(t => now - t < VIOLATION_WINDOW);
  
  // Add current timestamp
  data.timestamps.push(now);
  
  // Check if user has exceeded violation threshold
  if (data.timestamps.length >= MAX_VIOLATIONS) {
    // If user is already at max level, use the fixed max duration
    if (data.isMaxLevel) {
      const maxDelay = BASE_DELAY * Math.pow(2, MAX_LEVEL - 1);
      data.nextAllowedTime = now + maxDelay;
      
      return {
        allowed: false,
        reason: 'blocked',
        remaining: maxDelay
      };
    }
    
    // Increase violation level
    data.violationLevel = Math.min(data.violationLevel + 1, MAX_LEVEL);
    data.lastViolationTime = now; // Update last violation time
    
    // Check if we've reached max level
    if (data.violationLevel >= MAX_LEVEL) {
      data.isMaxLevel = true;
    }
    
    // Calculate new delay with exponential growth
    const newDelay = BASE_DELAY * Math.pow(2, data.violationLevel - 1);
    
    // Set next allowed time
    data.nextAllowedTime = now + newDelay;
    
    return {
      allowed: false,
      reason: data.violationLevel >= MAX_LEVEL ? 'blocked' : 'violation',
      remaining: newDelay
    };
  }

  // Apply base cooldown for normal operation - FIXED: Only apply if not in violation
  // This ensures the first command shows 3s, not 8s
  data.nextAllowedTime = now + BASE_DELAY;
  return { allowed: true };
}

// ============================================================================
// 💬 MESSAGE GENERATION
// ============================================================================

export function getCooldownMessage(remaining: number, reason: 'cooldown' | 'violation' | 'blocked' = 'cooldown') {
  const time = formatDuration(remaining);
  const messages = MESSAGE_CATEGORIES[reason];
  const randomMessage = messages[Math.floor(Math.random() * messages.length)];
  return randomMessage.replace('{time}', time);
}

// ============================================================================
// 🛠️ UTILITIES
// ============================================================================

export const formatDuration = (ms: number) => {
  const seconds = Math.ceil(ms / 1000);
  
  if (seconds > 60) {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds}s`;
  }
  
  return `${seconds}s`;
};

// ============================================================================
// 🔧 ADMIN HELPERS
// ============================================================================

export const clearUserData = (userId: string) => userData.delete(userId);
export const getUserData = (userId: string) => userData.get(userId);

export const getSystemStats = () => {
  let violations = 0, blocked = 0;
  for (const d of userData.values()) {
    violations += d.violationLevel - 1; // Subtract 1 for initial level
    if (d.isMaxLevel) blocked++;
  }
  return { totalUsers: userData.size, totalViolations: violations, blockedUsers: blocked };
};

// ============================================================================
// ⏰ RESET FUNCTIONALITY
// ============================================================================

export const resetUserCooldown = (userId: string) => {
  const data = userData.get(userId);
  if (data) {
    data.violationLevel = 1;
    data.isMaxLevel = false;
    data.nextAllowedTime = 0;
    data.timestamps = [];
    data.lastViolationTime = 0;
    data.lastLevelDecrease = 0;
    return true;
  }
  return false;
};

// ============================================================================
// 🔄 AUTOMATIC CLEANUP
// ============================================================================

// Clean up old user data to prevent memory leaks
export const cleanupOldData = () => {
  const now = Date.now();
  const CLEANUP_THRESHOLD = 24 * 60 * 60 * 1000; // 24 hours
  
  for (const [userId, data] of userData.entries()) {
    // Remove users who haven't had violations in 24 hours and are at level 1
    if (data.violationLevel === 1 && 
        now - data.lastViolationTime > CLEANUP_THRESHOLD) {
      userData.delete(userId);
    }
  }
};

// Get time until next level decrease for a user
export const getTimeUntilLevelDecrease = (userId: string): number | null => {
  const data = userData.get(userId);
  if (!data || data.violationLevel <= 1) return null;
  
  const timeSinceLastViolation = Date.now() - data.lastViolationTime;
  const timeSinceLastDecrease = Date.now() - data.lastLevelDecrease;
  
  if (timeSinceLastViolation < LEVEL_RESET_TIME) {
    return LEVEL_RESET_TIME - timeSinceLastViolation;
  }
  
  if (timeSinceLastDecrease < LEVEL_DECAY_INTERVAL) {
    return LEVEL_DECAY_INTERVAL - timeSinceLastDecrease;
  }
  
  return 0; // Ready for decrease
};