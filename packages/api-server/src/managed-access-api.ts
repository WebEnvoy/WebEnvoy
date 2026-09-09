import { createHash, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { ManagedAccessError, type FileManagedAccessStore, type createManagedBrowserService } from "@webenvoy/core-runtime";

export type ManagedAccessApiOptions = {
  supervisorToken?: string;
  managedAccessStore?: FileManagedAccessStore;
  managedBrowserService?: Pick<ReturnType<typeof createManagedBrowserService>, "submit" | "query">;
};

function send(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(body));
}
function reject(response: ServerResponse, status: number, code: string) {
  send(response, status, { ok: false, error: { code } });
}
function bearer(request: IncomingMessage): string | undefined {
  const authorizationHeaders = request.rawHeaders.filter((_, index, headers) => index % 2 === 0 && headers[index]?.toLowerCase() === "authorization");
  if (authorizationHeaders.length !== 1) return undefined;
  const value = request.headers.authorization;
  return typeof value === "string" && /^Bearer [A-Za-z0-9_-]{32,512}$/.test(value) ? value.slice(7) : undefined;
}
function equalToken(value: string, expected: string): boolean {
  const supplied = Buffer.from(value), owner = Buffer.from(expected);
  return supplied.length === owner.length && timingSafeEqual(supplied, owner);
}
function agentRoute(path: string): boolean {
  return path === "/agent-connections" || path === "/managed-browser/operations" || /^\/managed-browser\/operations\/[^/]+$/.test(path);
}

/** Production enables the owner gate at startup; authenticated Agent credentials have only these dedicated routes. */
export function authorizeCoreRequest(request: IncomingMessage, response: ServerResponse, path: string, options: ManagedAccessApiOptions): boolean {
  const count = request.rawHeaders.filter((_, index, headers) => index % 2 === 0 && headers[index]?.toLowerCase() === "authorization").length;
  if (count > 1) { reject(response, 401, "core_authentication_required"); return false; }
  if (request.method === "GET" && (path === "/health" || path === "/admission/health")) return true;
  if (agentRoute(path)) return true; // The dedicated handler authenticates against the persistent Principal owner.
  if (options.supervisorToken === undefined && options.managedAccessStore === undefined) return true;
  const token = bearer(request);
  if (!token || !options.supervisorToken || !equalToken(token, options.supervisorToken)) {
    reject(response, 401, "core_owner_authentication_required"); return false;
  }
  return true;
}

async function body(request: IncomingMessage): Promise<Record<string, unknown>> {
  if (request.headers["content-type"]?.split(";")[0]?.trim().toLowerCase() !== "application/json") throw new ManagedAccessError("managed_access_invalid_input");
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > 64 * 1024) throw new ManagedAccessError("managed_access_invalid_input");
    chunks.push(bytes);
  }
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    return parsed as Record<string, unknown>;
  } catch { throw new ManagedAccessError("managed_access_invalid_input"); }
}

export async function handleManagedAccessApi(request: IncomingMessage, response: ServerResponse, path: string, options: ManagedAccessApiOptions): Promise<boolean> {
  if (!agentRoute(path) && path !== "/agent-access" && !path.startsWith("/agent-access/")) return false;
  const store = options.managedAccessStore;
  if (!store) { reject(response, 503, "managed_access_unavailable"); return true; }
  try {
    if (agentRoute(path)) {
      const token = bearer(request);
      if (!token) { reject(response, 401, "managed_access_authentication_required"); return true; }
      const credentialHash = createHash("sha256").update(token).digest("hex");
      await store.authenticateCredential(credentialHash);
      if (path === "/agent-connections" && request.method === "POST") {
        send(response, 201, { ok: true, connection: await store.connect(credentialHash) }); return true;
      }
      const service = options.managedBrowserService;
      if (!service) { reject(response, 503, "managed_browser_unavailable"); return true; }
      if (path === "/managed-browser/operations" && request.method === "POST") {
        send(response, 200, await service.submit(credentialHash, await body(request))); return true;
      }
      const operation = /^\/managed-browser\/operations\/([^/]+)$/.exec(path);
      if (operation && request.method === "GET") {
        send(response, 200, await service.query(credentialHash, decodeURIComponent(operation[1]!))); return true;
      }
    } else {
      if (path === "/agent-access" && request.method === "GET") {
        send(response, 200, { ok: true, ...await store.list() }); return true;
      }
      const operation = /^\/agent-access\/operations\/([^/]+)$/.exec(path);
      if (operation && request.method === "GET") {
        const result = await store.getOwnerOperation(decodeURIComponent(operation[1]!));
        if (result) send(response, 200, { ok: true, operation: result });
        else reject(response, 404, "managed_access_operation_not_found");
        return true;
      }
      if (path === "/agent-access/principals" && request.method === "POST") {
        send(response, 201, { ok: true, principal: await store.registerPrincipal(await body(request)) }); return true;
      }
      if (path === "/agent-access/grants" && request.method === "POST") {
        send(response, 201, { ok: true, grant: await store.createGrant(await body(request)) }); return true;
      }
      const revoke = /^\/agent-access\/(principals|connections|grants)\/([^/]+)\/revoke$/.exec(path);
      if (revoke && request.method === "POST") {
        const input = await body(request);
        if (Object.keys(input).some(key => key !== "idempotency_key")) throw new ManagedAccessError("managed_access_invalid_input");
        const id = decodeURIComponent(revoke[2]!);
        const result = revoke[1] === "principals"
          ? { principal: await store.revokePrincipal({ idempotency_key: input.idempotency_key, principal_id: id }) }
          : revoke[1] === "connections"
            ? { connection: await store.revokeConnection({ idempotency_key: input.idempotency_key, connection_id: id }) }
            : { grant: await store.revokeGrant({ idempotency_key: input.idempotency_key, grant_id: id }) };
        send(response, 200, { ok: true, ...result }); return true;
      }
    }
    reject(response, 404, "managed_access_route_not_found");
  } catch (error) {
    const code = error instanceof ManagedAccessError ? error.code : "managed_access_unavailable";
    reject(response, code === "managed_access_authentication_required" ? 401 : code === "managed_access_invalid_input" || code === "managed_access_invalid_credential" ? 400 : error instanceof ManagedAccessError ? 403 : 503, code);
  }
  return true;
}
