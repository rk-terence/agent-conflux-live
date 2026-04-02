export class RetryExhaustedError extends Error {
  constructor(public readonly lastError: unknown) {
    super(`Retries exhausted: ${lastError}`);
    this.name = "RetryExhaustedError";
  }
}

export async function withRetry<T>(fn: () => Promise<T>, retries: number): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      lastError = err;
      if (attempt < retries) {
        // Exponential backoff: 1s, 2s, 4s...
        const delay = Math.min(1000 * Math.pow(2, attempt), 10000);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }
  throw new RetryExhaustedError(lastError);
}
