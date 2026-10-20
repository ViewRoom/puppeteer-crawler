export class CrawlError extends Error {
  constructor(
    message: string,
    public readonly retryable = true,
  ) {
    super(message);
    this.name = "CrawlError";
  }
}

export class NotFoundError extends Error {}
export class ConflictError extends Error {}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function throwIfAborted(signal?: AbortSignal): void {
  signal?.throwIfAborted();
}
