import { DATABASE_CONFIG, isRetryableError, getDatabaseErrorMessage, sleep } from './config.js';

// Re-export for external use
export { isRetryableError, getDatabaseErrorMessage };

/**
 * Add timeout to a database operation
 */
function withTimeout<T>(operation: () => Promise<T>, timeoutMs: number): Promise<T> {
  return Promise.race([
    operation(),
    new Promise<T>((_, reject) => 
      setTimeout(() => reject(new Error(`Operation timed out after ${timeoutMs}ms`)), timeoutMs)
    )
  ]);
}

/**
 * Execute a database operation with automatic retry logic for connection issues
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  operationName: string = 'database operation'
): Promise<T> {
  let lastError: any;
  
  for (let attempt = 1; attempt <= DATABASE_CONFIG.MAX_RETRIES; attempt++) {
    try {
      // Add timeout to prevent long-running queries
      const timeoutMs = DATABASE_CONFIG.QUERY_TIMEOUT * 1000;
      return await withTimeout(operation, timeoutMs);
    } catch (error) {
      lastError = error;
      
      // Check if this is a retryable error
      if (!isRetryableError(error)) {
        console.error(`Non-retryable error in ${operationName}:`, error);
        throw error;
      }
      
      console.warn(`${operationName} failed (attempt ${attempt}/${DATABASE_CONFIG.MAX_RETRIES}):`, error);
      
      // If this is the last attempt, don't wait
      if (attempt === DATABASE_CONFIG.MAX_RETRIES) {
        break;
      }
      
      // Wait before retrying
      await sleep(DATABASE_CONFIG.RETRY_DELAY * attempt); // Exponential backoff
    }
  }
  
  // All retries failed
  console.error(`${operationName} failed after ${DATABASE_CONFIG.MAX_RETRIES} attempts:`, lastError);
  throw new Error(getDatabaseErrorMessage(lastError));
}

/**
 * Execute multiple database operations with retry logic
 */
export async function withRetryAll<T>(
  operations: (() => Promise<T>)[],
  operationName: string = 'database operations'
): Promise<T[]> {
  return withRetry(async () => {
    return Promise.all(operations.map(op => op()));
  }, operationName);
}
