import { lookup as dnsLookup } from "node:dns/promises";
import { BlockList, isIP, type LookupFunction } from "node:net";
import { request as httpsRequest } from "node:https";
import type { IncomingMessage } from "node:http";
import { Transform } from "node:stream";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";
import { createHash, randomUUID } from "node:crypto";
import { normalizePublicHttpTarget, normalizePublicOrigin } from "./public-target-reference.js";

type Json = Record<string, unknown>;
const maximumBodyBytes = 4 * 1024 * 1024;
const maximumUrlBytes = 2048;
const maximumRedirects = 2;

export type ProgramPublicHttpPolicy = {
  transport: "program_anonymous_https";
  origin: string;
  pathname: string;
  allow_one_path_segment: boolean;
  query_keys: string[];
  headers: Record<string, string>;
  content_types: string[];
  max_response_bytes: number;
  max_redirects: number;
  timeout_ms: number;
};

export type ProgramPublicHttpCall = { url: string; method: "GET"; headers: Record<string, string> };
export type ProgramPublicHttpResponse = {
  ok: boolean;
  status: number;
  url: string;
  body: string;
  response_ref: string;
  content_type: string;
  facts: { url_sha256: string; pathname: string; status: number; content_type: string; body_sha256: string; body_bytes: number; redirect_count: number };
};

export class ProgramPublicHttpError extends Error {
  constructor(readonly code: string, readonly dispatch_state: "not_dispatched" | "dispatched" = "not_dispatched", readonly outcome_uncertain = false) {
    super(code);
  }
}

function fail(code: string, dispatchState: "not_dispatched" | "dispatched" = "not_dispatched", uncertain = false): never {
  throw new ProgramPublicHttpError(code, dispatchState, uncertain);
}
function isObject(value: unknown): value is Json { return Boolean(value && typeof value === "object" && !Array.isArray(value)); }
function exactObject(value: unknown, required: string[], optional: string[] = []): Json {
  if (!isObject(value) || required.some(key => !Object.hasOwn(value, key)) || Object.keys(value).some(key => !required.includes(key) && !optional.includes(key))) return fail("managed_task_network_policy_invalid");
  return value;
}
function string(value: unknown, code = "managed_task_network_policy_invalid", max = 512): string {
  if (typeof value !== "string" || !value || value.trim() !== value || value.length > max || /[\u0000-\u001f\u007f-\u009f]/.test(value)) return fail(code);
  return value;
}
function uniqueStrings(value: unknown, max: number): string[] {
  if (!Array.isArray(value) || value.length > max) return fail("managed_task_network_policy_invalid");
  const items = value.map(item => string(item));
  if (new Set(items).size !== items.length) return fail("managed_task_network_policy_invalid");
  return items;
}

export function parseProgramPublicHttpPolicy(value: unknown, taskOrigin: string): ProgramPublicHttpPolicy {
  const source = exactObject(value,
    ["transport", "origin", "pathname", "allow_one_path_segment", "query_keys", "headers", "content_types", "max_response_bytes", "max_redirects", "timeout_ms"]);
  const origin = string(source.origin);
  if (source.transport !== "program_anonymous_https" || normalizePublicOrigin(origin) !== origin || !origin.startsWith("https://") || origin !== taskOrigin || isIP(new URL(origin).hostname)) return fail("managed_task_network_policy_invalid");
  const pathname = string(source.pathname);
  if (!pathname.startsWith("/") || pathname.includes("?") || pathname.includes("#") || pathname.includes("\\") || pathname.split("/").some(part => part === "." || part === ".." || /%2f|%5c|%2e/i.test(part))) return fail("managed_task_network_policy_invalid");
  if (typeof source.allow_one_path_segment !== "boolean") return fail("managed_task_network_policy_invalid");
  const queryKeys = uniqueStrings(source.query_keys, 32);
  if (queryKeys.some(key => !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(key))) return fail("managed_task_network_policy_invalid");
  const headersSource = exactObject(source.headers, [] , ["accept", "user-agent"]);
  const headers: Record<string, string> = {};
  for (const key of Object.keys(headersSource).sort()) headers[key] = string(headersSource[key]);
  const contentTypes = uniqueStrings(source.content_types, 8).map(type => type.toLowerCase());
  if (!contentTypes.length || contentTypes.some(type => !/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(type))) return fail("managed_task_network_policy_invalid");
  if (!Number.isSafeInteger(source.max_response_bytes) || Number(source.max_response_bytes) < 1 || Number(source.max_response_bytes) > maximumBodyBytes ||
      !Number.isSafeInteger(source.max_redirects) || Number(source.max_redirects) < 0 || Number(source.max_redirects) > maximumRedirects ||
      !Number.isSafeInteger(source.timeout_ms) || Number(source.timeout_ms) < 1 || Number(source.timeout_ms) > 60_000) return fail("managed_task_network_policy_invalid");
  return { transport: "program_anonymous_https", origin, pathname, allow_one_path_segment: source.allow_one_path_segment,
    query_keys: queryKeys, headers, content_types: contentTypes, max_response_bytes: Number(source.max_response_bytes),
    max_redirects: Number(source.max_redirects), timeout_ms: Number(source.timeout_ms) };
}

export function validateProgramPublicHttpCall(policy: ProgramPublicHttpPolicy, value: unknown): { url: URL; call: ProgramPublicHttpCall } {
  const source = exactObject(value, ["url", "method", "headers"]);
  const rawUrl = string(source.url, "managed_task_network_url_denied", maximumUrlBytes);
  if (Buffer.byteLength(rawUrl, "utf8") > maximumUrlBytes || rawUrl.includes("#")) return fail("managed_task_network_url_denied");
  const rawPath = /^https:\/\/[^/?#]+([^?#]*)/i.exec(rawUrl)?.[1] || "/";
  if (rawPath.split("/").some(part => part === "." || part === ".." || /%2f|%5c|%2e/i.test(part)) || rawPath.includes("\\")) return fail("managed_task_network_url_denied");
  let url: URL;
  try { url = new URL(rawUrl); } catch { return fail("managed_task_network_url_denied"); }
  const normalized = normalizePublicHttpTarget(rawUrl);
  if (!normalized.ok || url.protocol !== "https:" || url.origin !== policy.origin || url.username || url.password || url.port || isIP(url.hostname)) return fail("managed_task_network_url_denied");
  const exactPath = url.pathname === policy.pathname;
  if (!exactPath) {
    if (!policy.allow_one_path_segment || !url.pathname.startsWith(`${policy.pathname}/`)) return fail("managed_task_network_url_denied");
    const suffix = url.pathname.slice(policy.pathname.length + 1);
    if (!suffix || suffix.includes("/")) return fail("managed_task_network_url_denied");
    let decoded: string;
    try { decoded = decodeURIComponent(suffix); } catch { return fail("managed_task_network_url_denied"); }
    if (!decoded || Buffer.byteLength(decoded, "utf8") > 512 || decoded === "." || decoded === ".." ||
        /[\\/\u0000-\u001f\u007f-\u009f]/.test(decoded) || /%(?:2f|5c|2e|00)/i.test(decoded)) return fail("managed_task_network_url_denied");
  }
  const allowedQuery = new Set(policy.query_keys);
  const observed = new Set<string>();
  for (const [key, queryValue] of url.searchParams) {
    if (!allowedQuery.has(key) || observed.has(key) || Buffer.byteLength(key, "utf8") > 512 || Buffer.byteLength(queryValue, "utf8") > 512) return fail("managed_task_network_url_denied");
    observed.add(key);
  }
  if (source.method !== "GET") return fail("managed_task_network_method_denied");
  const headersSource = exactObject(source.headers, Object.keys(policy.headers));
  if (Object.keys(headersSource).length !== Object.keys(policy.headers).length || Object.entries(policy.headers).some(([key, expected]) => headersSource[key] !== expected)) return fail("managed_task_network_header_denied");
  return { url, call: { url: url.href, method: "GET", headers: { ...policy.headers } } };
}

const blockedAddresses = new BlockList();
const globallyRoutableIpv6 = new BlockList();
globallyRoutableIpv6.addSubnet("2000::", 3, "ipv6");
for (const [subnet, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
  ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16],
  ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4]
] as const) blockedAddresses.addSubnet(subnet, prefix, "ipv4");
for (const [subnet, prefix] of [["2001::", 23], ["2001:db8::", 32], ["2002::", 16], ["3fff::", 20]] as const) blockedAddresses.addSubnet(subnet, prefix, "ipv6");

export function isPubliclyRoutableAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !blockedAddresses.check(address, "ipv4");
  if (family !== 6 || !globallyRoutableIpv6.check(address, "ipv6") || blockedAddresses.check(address, "ipv6")) return false;
  return true;
}

type Address = { address: string; family: number };
type HopResult = { status: number; location?: string; content_type?: string; body?: string };
type ReaderDependencies = {
  lookup?: (hostname: string, timeoutMs: number, signal?: AbortSignal) => Promise<Address[]>;
  send?: (url: URL, address: Address, headers: Record<string, string>, maxBytes: number, timeoutMs: number, signal?: AbortSignal) => Promise<HopResult>;
  beforeDispatch?: (url: URL, hop: { url_sha256: string; pathname: string; hop_index: number }) => Promise<void> | void;
};

async function resolvePublicAddress(hostname: string, timeoutMs: number, signal?: AbortSignal): Promise<Address[]> {
  if (signal?.aborted) return fail("managed_task_network_cancelled");
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let abortHandler: (() => void) | undefined;
  try {
    const records = await Promise.race([
      dnsLookup(hostname, { all: true, verbatim: true }),
      new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new ProgramPublicHttpError("managed_task_network_timeout")), timeoutMs); }),
      ...(signal ? [new Promise<never>((_, reject) => {
        abortHandler = () => reject(new ProgramPublicHttpError("managed_task_network_cancelled"));
        signal.addEventListener("abort", abortHandler, { once: true });
      })] : [])
    ]);
    if (signal?.aborted || !records.length || records.some(item => !isPubliclyRoutableAddress(item.address))) return fail("managed_task_network_address_denied");
    return records.map(item => ({ address: item.address, family: item.family }));
  } catch (error) {
    if (error instanceof ProgramPublicHttpError) throw error;
    return fail("managed_task_network_dns_unavailable");
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
    if (signal && abortHandler) signal.removeEventListener("abort", abortHandler);
  }
}

function decodeResponse(response: IncomingMessage, maxBytes: number, timeoutMs: number, request: ReturnType<typeof httpsRequest>): Promise<string> {
  const contentEncoding = String(response.headers["content-encoding"] ?? "identity").trim().toLowerCase();
  const decoder = contentEncoding === "identity" || contentEncoding === "" ? undefined
    : contentEncoding === "gzip" ? createGunzip()
      : contentEncoding === "deflate" ? createInflate()
        : contentEncoding === "br" ? createBrotliDecompress() : undefined;
  if (contentEncoding !== "identity" && contentEncoding !== "" && !decoder) {
    response.destroy();
    return Promise.reject(new ProgramPublicHttpError("managed_task_network_encoding_denied", "dispatched"));
  }
  let encodedBytes = 0;
  let decodedBytes = 0;
  const meter = new Transform({ transform(chunk: Buffer, _encoding, callback) {
    encodedBytes += chunk.byteLength;
    if (encodedBytes > maxBytes) { callback(new ProgramPublicHttpError("managed_task_network_response_too_large", "dispatched")); return; }
    callback(null, chunk);
  } });
  const source = response.pipe(meter);
  const decoded = decoder ? source.pipe(decoder) : source;
  const chunks: Buffer[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  return new Promise((resolve, reject) => {
    let settled = false;
    const failOnce = (error: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      request.destroy();
      const value = error instanceof ProgramPublicHttpError ? error : new ProgramPublicHttpError("managed_task_network_response_invalid", "dispatched");
      reject(value);
    };
    timer = setTimeout(() => failOnce(new ProgramPublicHttpError("managed_task_network_timeout", "dispatched", true)), timeoutMs);
    decoded.on("data", (chunk: Buffer) => {
      decodedBytes += chunk.byteLength;
      if (decodedBytes > maxBytes) { failOnce(new ProgramPublicHttpError("managed_task_network_response_too_large", "dispatched")); return; }
      chunks.push(Buffer.from(chunk));
    });
    decoded.on("error", failOnce);
    decoded.on("end", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (!response.complete) {
        reject(new ProgramPublicHttpError("managed_task_network_response_incomplete", "dispatched", true));
        return;
      }
      try { resolve(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))); }
      catch { reject(new ProgramPublicHttpError("managed_task_network_utf8_invalid", "dispatched")); }
    });
    response.once("aborted", () => failOnce(new ProgramPublicHttpError("managed_task_network_response_incomplete", "dispatched", true)));
    response.on("error", failOnce);
    source.on("error", failOnce);
  });
}

async function sendPinnedHttps(url: URL, address: Address, headers: Record<string, string>, maxBytes: number, timeoutMs: number, signal?: AbortSignal): Promise<HopResult> {
  const lookupPinned: LookupFunction = (_hostname, _options, callback) => {
    (callback as (error: NodeJS.ErrnoException | null, address: string, family?: number) => void)(null, address.address, address.family);
  };
  const request = httpsRequest(url, {
    method: "GET", agent: false, lookup: lookupPinned, servername: url.hostname, rejectUnauthorized: true,
    headers: { ...headers, "accept-encoding": "gzip, deflate, br" }, ...(signal ? { signal } : {})
  });
  return await new Promise<HopResult>((resolve, reject) => {
    let settled = false;
    let responseReceived = false;
    const totalTimeout = setTimeout(() => failOnce(new ProgramPublicHttpError("managed_task_network_timeout", "dispatched", true)), timeoutMs);
    const failOnce = (error: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(totalTimeout);
      request.destroy();
      if (error instanceof ProgramPublicHttpError) reject(error);
      else reject(new ProgramPublicHttpError("managed_task_network_unavailable", "dispatched", true));
    };
    request.setTimeout(timeoutMs, () => failOnce(new ProgramPublicHttpError("managed_task_network_timeout", "dispatched", true)));
    request.once("error", error => {
      if (responseReceived) return;
      failOnce(error);
    });
    request.once("response", response => {
      responseReceived = true;
      const status = response.statusCode;
      if (!status || status < 100 || status > 599) {
        response.destroy();
        if (!settled) { settled = true; clearTimeout(totalTimeout); reject(new ProgramPublicHttpError("managed_task_network_response_invalid", "dispatched")); }
        return;
      }
      const location = typeof response.headers.location === "string" ? response.headers.location : undefined;
      const contentType = typeof response.headers["content-type"] === "string" ? response.headers["content-type"] : undefined;
      void decodeResponse(response, maxBytes, timeoutMs, request).then(body => {
        if (settled) return;
        settled = true;
        clearTimeout(totalTimeout);
        resolve({ status, ...(location ? { location } : {}), ...(contentType ? { content_type: contentType } : {}), body });
      }, error => {
        if (settled) return;
        settled = true;
        clearTimeout(totalTimeout);
        reject(error);
      });
    });
    request.end();
  });
}

function allowedPath(policy: ProgramPublicHttpPolicy, url: URL): boolean {
  if (url.pathname === policy.pathname) return true;
  if (!policy.allow_one_path_segment || !url.pathname.startsWith(`${policy.pathname}/`)) return false;
  const segment = url.pathname.slice(policy.pathname.length + 1);
  if (!segment || segment.includes("/")) return false;
  try {
    const decoded = decodeURIComponent(segment);
    return Boolean(decoded && Buffer.byteLength(decoded, "utf8") <= 512 && decoded !== "." && decoded !== ".." &&
      !/[\\/\u0000-\u001f\u007f-\u009f]/.test(decoded) && !/%(?:2f|5c|2e|00)/i.test(decoded));
  } catch { return false; }
}

function validateRedirect(policy: ProgramPublicHttpPolicy, current: URL, location: string): URL {
  let next: URL;
  try { next = new URL(location, current); } catch { return fail("managed_task_network_redirect_denied", "dispatched"); }
  try { validateProgramPublicHttpCall(policy, { url: next.href, method: "GET", headers: policy.headers }); }
  catch { return fail("managed_task_network_redirect_denied", "dispatched"); }
  return next;
}

function validContentType(policy: ProgramPublicHttpPolicy, value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 256 || /[\r\n\u0000]/.test(value)) return undefined;
  const [mediaType, ...parameters] = value.split(";");
  const normalized = mediaType?.trim().toLowerCase();
  if (!normalized || !policy.content_types.includes(normalized)) return undefined;
  if (parameters.length > 1) return undefined;
  for (const parameter of parameters) {
    const match = /^\s*charset\s*=\s*["']?([^;"']+)["']?\s*$/i.exec(parameter);
    if (!match || !["utf-8", "utf8"].includes(match[1]!.trim().toLowerCase())) return undefined;
  }
  return value.trim();
}

export async function readProgramPublicHttp(policy: ProgramPublicHttpPolicy, value: unknown, dependencies: ReaderDependencies = {}, signal?: AbortSignal): Promise<ProgramPublicHttpResponse> {
  const { url: initialUrl, call } = validateProgramPublicHttpCall(policy, value);
  const lookup = dependencies.lookup ?? resolvePublicAddress;
  const send = dependencies.send ?? sendPinnedHttps;
  const deadline = Date.now() + policy.timeout_ms;
  let current = initialUrl;
  let redirects = 0;
  let dispatched = false;
  for (;;) {
    if (signal?.aborted) return fail("managed_task_network_cancelled", dispatched ? "dispatched" : "not_dispatched", dispatched);
    if (Date.now() >= deadline) return fail("managed_task_network_timeout", dispatched ? "dispatched" : "not_dispatched", dispatched);
    const remaining = Math.max(1, deadline - Date.now());
    let addresses: Address[];
    try { addresses = await lookup(current.hostname, remaining, signal); }
    catch (error) {
      if (error instanceof ProgramPublicHttpError) return fail(error.code, dispatched ? "dispatched" : error.dispatch_state,
        dispatched || error.outcome_uncertain);
      return fail("managed_task_network_dns_unavailable", dispatched ? "dispatched" : "not_dispatched", dispatched);
    }
    if (!addresses.length || addresses.some(item => !isPubliclyRoutableAddress(item.address))) return fail("managed_task_network_address_denied", dispatched ? "dispatched" : "not_dispatched");
    try { await dependencies.beforeDispatch?.(current, { url_sha256: createHash("sha256").update(current.href).digest("hex"), pathname: current.pathname, hop_index: redirects }); }
    catch { return fail("managed_task_network_authorization_changed", dispatched ? "dispatched" : "not_dispatched", dispatched); }
    if (signal?.aborted) return fail("managed_task_network_cancelled", dispatched ? "dispatched" : "not_dispatched", dispatched);
    dispatched = true;
    let response: HopResult;
    try { response = await send(current, addresses[0]!, call.headers, policy.max_response_bytes, remaining, signal); }
    catch (error) {
      if (error instanceof ProgramPublicHttpError) return fail(error.code, "dispatched", error.outcome_uncertain);
      return fail("managed_task_network_unavailable", "dispatched", true);
    }
    if ([301, 302, 303, 307, 308].includes(response.status) && response.location) {
      if (redirects >= policy.max_redirects) return fail("managed_task_network_redirect_limit", "dispatched");
      current = validateRedirect(policy, current, response.location);
      redirects += 1;
      continue;
    }
    const contentType = validContentType(policy, response.content_type);
    if (!contentType || typeof response.body !== "string") return fail("managed_task_network_content_type_denied", "dispatched");
    const bodyBytes = Buffer.byteLength(response.body, "utf8");
    if (bodyBytes > policy.max_response_bytes) return fail("managed_task_network_response_too_large", "dispatched");
    const responseRef = `webenvoy:public-http-response/${randomUUID()}`;
    const bodySha256 = createHash("sha256").update(response.body).digest("hex");
    return {
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      url: current.href,
      body: response.body,
      response_ref: responseRef,
      content_type: contentType,
      facts: { url_sha256: createHash("sha256").update(current.href).digest("hex"), pathname: current.pathname,
        status: response.status, content_type: contentType, body_sha256: bodySha256, body_bytes: bodyBytes, redirect_count: redirects }
    };
  }
}
