/**
 * Database configuration and connection pool settings
 * 
 * This file contains configuration for managing database connections
 * to prevent connection pool exhaustion and improve reliability.
 */

export const DATABASE_CONFIG = {
  // Connection pool settings (these are applied via DATABASE_URL)
  // Add these parameters to your DATABASE_URL:
  // ?connection_limit=5&pool_timeout=20&connect_timeout=60
  
  // Recommended DATABASE_URL format:
  // postgresql://username:password@host:port/database?connection_limit=5&pool_timeout=20&connect_timeout=60
  
  // Connection pool limits
  MAX_CONNECTIONS: 5,        // Maximum number of connections in the pool
  POOL_TIMEOUT: 20,          // Timeout for getting a connection from the pool (seconds)
  CONNECT_TIMEOUT: 60,       // Timeout for establishing a connection (seconds)
  
  // Query timeouts
  QUERY_TIMEOUT: 30,         // Timeout for individual queries (seconds)
  
  // Retry settings
  MAX_RETRIES: 3,            // Maximum number of retry attempts
  RETRY_DELAY: 1000,         // Delay between retries (milliseconds)
  
  // Error codes that should trigger retries
  RETRYABLE_ERROR_CODES: [
    'P1001',  // Can't reach database server
    'P2024',  // Timed out fetching a new connection from the connection pool
    'P2034',  // Transaction failed due to a write conflict or a deadlock
    'P2028',  // Client has encountered a connection error and is not able to send requests to the engine
    'P1017',  // Server closed the connection
    'P1008',  // Operations timed out
  ],
};

/**
 * Check if an error is retryable based on its error code
 */
export function isRetryableError(error: any): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }
  
  // Check for PrismaClientInitializationError (connection issues)
  if (error.name === 'PrismaClientInitializationError') {
    return true; // All initialization errors are retryable
  }
  
  // Check for specific error codes
  if ('code' in error) {
    return DATABASE_CONFIG.RETRYABLE_ERROR_CODES.includes(error.code);
  }
  
  // Check for connection-related error messages
  if (error.message) {
    const message = error.message.toLowerCase();
    if (message.includes("can't reach database server") ||
        message.includes("connection") ||
        message.includes("timeout") ||
        message.includes("network")) {
      return true;
    }
  }
  
  return false;
}

/**
 * Get a user-friendly error message for database errors
 */
export function getDatabaseErrorMessage(error: any): string {
  if (!error || typeof error !== 'object') {
    return 'An unexpected database error occurred. Please try again later.';
  }
  
  // Handle PrismaClientInitializationError
  if (error.name === 'PrismaClientInitializationError') {
    if (error.message && error.message.includes("Can't reach database server")) {
      return 'Database server is unreachable. Please check if your Supabase database is running.';
    }
    return 'Database connection failed. Please try again later.';
  }
  
  // Handle specific error codes
  if ('code' in error) {
    switch (error.code) {
      case 'P1001':
        return 'Database connection failed. Please try again later.';
      case 'P2024':
        return 'Database operation timed out. Please try again later.';
      case 'P2034':
        return 'Database transaction failed. Please try again later.';
      case 'P2028':
        return 'Database connection error. Please try again later.';
      case 'P1017':
        return 'Database connection was closed. Please try again later.';
      case 'P1008':
        return 'Database operation timed out. Please try again later.';
      default:
        return 'A database error occurred. Please try again later.';
    }
  }
  
  return 'A database error occurred. Please try again later.';
}

/**
 * Sleep utility for retry delays
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
