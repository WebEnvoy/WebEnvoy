import type { IncomingMessage } from "node:http";
import {
  ProviderLifecycleIdempotencyCapacityError,
  ProviderLifecycleIdempotencyConflict,
  type ProviderLifecycleIdempotencyStore
} from "./provider-lifecycle-idempotency.js";

export class ProviderLifecycleHttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly retryAfterMs: number | null = null
  ) {
    super(message);
  }
}

export async function readProviderMutationJson(request: IncomingMessage): Promise<unknown> {
  const mediaType = request.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase();
  if (mediaType !== "application/json") {
    throw new ProviderLifecycleHttpError(415, "unsupported_media_type", "Provider mutations require application/json.");
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 16_384) throw new ProviderLifecycleHttpError(413, "payload_too_large", "Provider mutation body exceeds 16KB.");
    chunks.push(buffer);
  }
  if (chunks.length === 0) throw new ProviderLifecycleHttpError(400, "bad_request", "Expected JSON request body.");
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new ProviderLifecycleHttpError(400, "bad_request", "Invalid JSON request body.");
  }
}

export async function idempotentProviderMutation<T>(
  request: IncomingMessage,
  store: ProviderLifecycleIdempotencyStore,
  action: string,
  input: unknown,
  operation: () => Promise<T>
): Promise<T> {
  const key = providerIdempotencyKey(request);
  try {
    return await store.execute(key, `${action}\0${stableJson(input)}`, operation);
  } catch (error) {
    if (error instanceof ProviderLifecycleIdempotencyConflict) {
      throw new ProviderLifecycleHttpError(409, "idempotency_conflict", error.message);
    }
    if (error instanceof ProviderLifecycleIdempotencyCapacityError) {
      throw new ProviderLifecycleHttpError(503, "idempotency_capacity_exceeded", error.message, error.retryAfterMs);
    }
    throw error;
  }
}

export function requireEmptyProviderJsonObject(value: unknown, message: string): void {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== 0) {
    throw new ProviderLifecycleHttpError(400, "bad_request", message);
  }
}

function providerIdempotencyKey(request: IncomingMessage): string {
  const value = request.headers["idempotency-key"];
  if (typeof value !== "string" || value !== value.trim() || value.length < 1 || value.length > 200 || value.includes(",")) {
    throw new ProviderLifecycleHttpError(400, "bad_request", "A single valid Idempotency-Key is required.");
  }
  return value;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
