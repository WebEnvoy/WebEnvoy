export interface ProviderLifecycleIdempotencyOptions {
  ttl_ms?: number;
  capacity?: number;
  now?: () => number;
}

interface Receipt<T> {
  fingerprint: string;
  createdAt: number;
  result: Promise<T>;
  settled: boolean;
}

export class ProviderLifecycleIdempotencyConflict extends Error {}
export class ProviderLifecycleIdempotencyCapacityError extends Error {
  constructor(message: string, readonly retryAfterMs: number) {
    super(message);
  }
}

export class ProviderLifecycleIdempotencyStore {
  private readonly ttlMs: number;
  private readonly capacity: number;
  private readonly now: () => number;
  private readonly receipts = new Map<string, Receipt<unknown>>();

  constructor(options: ProviderLifecycleIdempotencyOptions = {}) {
    this.ttlMs = boundedInteger(options.ttl_ms, 10 * 60_000, 1, 24 * 60 * 60_000);
    this.capacity = boundedInteger(options.capacity, 1_000, 1, 10_000);
    this.now = options.now ?? Date.now;
  }

  execute<T>(key: string, fingerprint: string, operation: () => Promise<T>): Promise<T> {
    this.expire();
    const receipt = this.receipts.get(key);
    if (receipt) {
      if (receipt.fingerprint !== fingerprint) throw new ProviderLifecycleIdempotencyConflict("Idempotency-Key was already used for a different request.");
      return receipt.result as Promise<T>;
    }
    if (this.receipts.size >= this.capacity) {
      throw new ProviderLifecycleIdempotencyCapacityError(
        "Provider idempotency receipt capacity is temporarily full.",
        this.retryAfterMs()
      );
    }
    const result = new Promise<T>((resolve, reject) => {
      queueMicrotask(() => {
        try { void operation().then(resolve, reject); } catch (cause) { reject(cause); }
      });
    });
    const next: Receipt<T> = { fingerprint, createdAt: this.now(), result, settled: false };
    this.receipts.set(key, next);
    void result.then(() => { next.settled = true; }, () => { next.settled = true; });
    return result;
  }

  private expire(): void {
    const cutoff = this.now() - this.ttlMs;
    for (const [key, receipt] of this.receipts) {
      if (receipt.settled && receipt.createdAt <= cutoff) this.receipts.delete(key);
    }
  }

  private retryAfterMs(): number {
    const now = this.now();
    let retryAfter = this.ttlMs;
    for (const receipt of this.receipts.values()) {
      if (receipt.settled) retryAfter = Math.min(retryAfter, Math.max(1, receipt.createdAt + this.ttlMs - now));
    }
    return Math.max(1, Math.min(this.ttlMs, retryAfter));
  }
}

function boundedInteger(value: number | undefined, fallback: number, minimum: number, maximum: number): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new Error("Invalid provider idempotency store bounds.");
  return value;
}
