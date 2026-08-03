import { ownerApiResponseMaxBytes, readBoundedJsonResponse } from "../electron/boundedJsonResponse";
import { projectOwnerApiError } from "../electron/ownerApiErrorProjection";

export type OwnerApiMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type OwnerApiRequestOptions = {
  method?: OwnerApiMethod;
  body?: unknown;
  timeoutMs?: number;
  signal?: AbortSignal;
  includeErrorBody?: boolean;
};

export async function requestOwnerJson(
  base: string,
  path: string,
  options: OwnerApiRequestOptions = {},
): Promise<unknown> {
  const shellRequest = window.webenvoyShell?.requestOwnerJson;
  if (shellRequest) {
    options.signal?.throwIfAborted();
    const result = await shellRequest({
      base,
      path,
      method: options.method ?? "GET",
      ...(options.body === undefined ? {} : { body: options.body }),
    });
    options.signal?.throwIfAborted();
    return unwrapOwnerApiResponse(result, path, options.includeErrorBody === true);
  }

  return requestOwnerJsonWithFetch(base, path, options);
}

async function requestOwnerJsonWithFetch(
  base: string,
  path: string,
  options: OwnerApiRequestOptions,
): Promise<unknown> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), options.timeoutMs ?? 2500);
  try {
    const response = await fetch(`${base}${path}`, {
      method: options.method ?? "GET",
      credentials: "omit",
      headers: {
        Accept: "application/json",
        ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      signal: options.signal == null ? controller.signal : AbortSignal.any([controller.signal, options.signal]),
    });
    const payload = await readBoundedJsonResponse(response, ownerApiResponseMaxBytes(path));
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        error: projectOwnerHttpStatusError(path, response.status, payload),
        ...(options.includeErrorBody === true && payload !== undefined ? { body: payload } : {}),
      };
    }
    return payload ?? {};
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    window.clearTimeout(timeout);
  }
}

function unwrapOwnerApiResponse(value: unknown, path: string, includeErrorBody: boolean): unknown {
  if (!isRecord(value)) return { ok: false, error: `${path} returned invalid owner API response.` };
  if (value.ok === true) return "body" in value ? value.body : {};

  const error = typeof value.error === "string" ? value.error : `${path} owner API request failed.`;
  return {
    ok: false,
    ...(typeof value.status === "number" ? { status: value.status } : {}),
    error,
    ...(includeErrorBody && value.body !== undefined ? { body: value.body } : {}),
  };
}

export function projectOwnerHttpStatusError(path: string, status: number, payload: unknown) {
  const error = projectOwnerApiError(payload);
  return [`${path} returned ${status}`, error?.category, error?.code].filter(Boolean).join(": ");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
