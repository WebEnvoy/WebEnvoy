export type BoundedJsonResponseErrorCode =
  | "response_media_type_unsupported"
  | "response_too_large"
  | "response_json_malformed";

export class BoundedJsonResponseError extends Error {
  constructor(readonly code: BoundedJsonResponseErrorCode) {
    super(code);
    this.name = "BoundedJsonResponseError";
  }
}

function hasJsonMediaType(response: Response): boolean {
  return response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() === "application/json";
}

export async function cancelResponseBody(response: Response, reader?: ReadableStreamDefaultReader<Uint8Array>): Promise<void> {
  try {
    if (reader) await reader.cancel();
    else await response.body?.cancel();
  } catch {
    // Cancellation is best effort; the bounded read has already stopped.
  }
}

export async function readBoundedJsonResponse(response: Response, maxBytes: number): Promise<unknown> {
  if (!Number.isInteger(maxBytes) || maxBytes <= 0) throw new RangeError("maxBytes must be a positive integer");
  if (!hasJsonMediaType(response)) {
    await cancelResponseBody(response);
    throw new BoundedJsonResponseError("response_media_type_unsupported");
  }

  const contentLength = response.headers.get("content-length");
  if (contentLength !== null && /^\d+$/.test(contentLength) && Number(contentLength) > maxBytes) {
    await cancelResponseBody(response);
    throw new BoundedJsonResponseError("response_too_large");
  }

  const reader = response.body?.getReader();
  if (!reader) throw new BoundedJsonResponseError("response_json_malformed");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await cancelResponseBody(response, reader);
      throw new BoundedJsonResponseError("response_too_large");
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } catch {
    throw new BoundedJsonResponseError("response_json_malformed");
  }
}
