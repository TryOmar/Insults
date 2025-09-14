/**
 * Database error handling utilities
 * Provides consistent error handling for database connection issues
 */

export interface DatabaseError extends Error {
  code?: string;
  meta?: any;
}

/**
 * Checks if an error is a database connection error
 */
export function isDatabaseConnectionError(error: any): error is DatabaseError {
  return error && 
         typeof error === 'object' && 
         'code' in error && 
         (error.code === 'P1001' || error.code === 'P1002' || error.code === 'P1003');
}

/**
 * Gets a user-friendly error message for database errors
 */
export function getDatabaseErrorMessage(error: any): string {
  if (isDatabaseConnectionError(error)) {
    switch (error.code) {
      case 'P1001':
        return 'Database connection failed. Please try again later.';
      case 'P1002':
        return 'Database connection timeout. Please try again later.';
      case 'P1003':
        return 'Database connection refused. Please try again later.';
      default:
        return 'Database connection error. Please try again later.';
    }
  }
  
  return 'An unexpected error occurred. Please try again later.';
}

/**
 * Wraps a database operation with error handling
 */
export async function withDatabaseErrorHandling<T>(
  operation: () => Promise<T>,
  fallback?: T
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (isDatabaseConnectionError(error)) {
      console.error('Database connection error:', error);
      if (fallback !== undefined) {
        return fallback;
      }
      throw new Error(getDatabaseErrorMessage(error));
    }
    throw error;
  }
}
