import { setTimeout } from "node:timers/promises";
import { CrawlError, throwIfAborted } from "../../domain/errors.js";

export async function retry<T>(
  operation: () => Promise<T>,
  options: {
    retries: number;
    retryDelayMs: number;
    signal?: AbortSignal;
    onAttempt?: () => void;
    onRetry?: (error: unknown, attempt: number) => void;
  },
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    throwIfAborted(options.signal);
    options.onAttempt?.();
    try {
      return await operation();
    } catch (error) {
      throwIfAborted(options.signal);
      if (
        attempt >= options.retries ||
        (error instanceof CrawlError && !error.retryable)
      )
        throw error;
      options.onRetry?.(error, attempt + 1);
      await setTimeout(
        Math.min(options.retryDelayMs * 2 ** attempt, 60_000),
        undefined,
        { signal: options.signal },
      );
    }
  }
}
