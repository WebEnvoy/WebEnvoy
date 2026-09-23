import { createHash, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { ExecutionPolicyVersionConflictError, ManagedAccessError, type FileManagedAccessStore, type createManagedBrowserService, type createFileSkillLibraryService, type createManagedRecoveryService, type createManagedTaskService } from "@webenvoy/core-runtime";

export type ManagedAccessApiOptions = {
  supervisorToken?: string;
  managedAccessStore?: FileManagedAccessStore;
  managedBrowserService?: Pick<ReturnType<typeof createManagedBrowserService>, "submit" | "query"> &
    Partial<Pick<ReturnType<typeof createManagedBrowserService>, "describe" | "getManagementPolicy" | "putManagementPolicy">>;
  managedSkillService?: Pick<ReturnType<typeof createFileSkillLibraryService>, "submit" | "query">;
  managedTaskService?: Pick<ReturnType<typeof createManagedTaskService>, "operate">;
  managedRecoveryService?: Pick<ReturnType<typeof createManagedRecoveryService>, "inspect" | "backup" | "plan" | "apply" | "status" | "request">;
  managedFileService?: {
    importFile(input: Record<string, unknown>): Promise<unknown>;
    inspect(fileRef?: string): Promise<unknown>;
    exportFile(input: Record<string, unknown>): Promise<unknown>;
    revoke(fileRef: string): Promise<unknown>;
    delete(fileRef: string): Promise<unknown>;
  };
};

function send(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(body));
}
function reject(response: ServerResponse, status: number, code: string, notDispatched = false) {
  send(response, status, { ok: false, error: { code }, ...(notDispatched ? { dispatch_state: "not_dispatched" } : {}) });
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
  return path === "/agent-connections" || path === "/managed-browser/capabilities/describe" || path === "/managed-browser/operations" || /^\/managed-browser\/operations\/[^/]+$/.test(path) || path === "/managed-skills/operations" || /^\/managed-skills\/operations\/[^/]+$/.test(path) || path === "/managed-tasks/operations";
}
function ownerRecoveryRoute(path: string): boolean {
  return path === "/owner/recovery/inspect" || path === "/owner/recovery/backup" || path === "/owner/recovery/plan" || path === "/owner/recovery/apply" || /^\/owner\/recovery\/status\/[^/]+$/.test(path);
}
function ownerFileRoute(path: string): boolean {
  return path === "/owner/files" || path === "/owner/files/import" || path === "/owner/files/export" || /^\/owner\/files\/(revoke|delete)$/.test(path);
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

async function body(request: IncomingMessage, maxBytes = 64 * 1024, invalidCode = "managed_access_invalid_input"): Promise<Record<string, unknown>> {
  if (request.headers["content-type"]?.split(";")[0]?.trim().toLowerCase() !== "application/json") throw new ManagedAccessError(invalidCode);
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > maxBytes) throw new ManagedAccessError(invalidCode);
    chunks.push(bytes);
  }
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    return parsed as Record<string, unknown>;
  } catch { throw new ManagedAccessError(invalidCode); }
}

export async function handleManagedAccessApi(request: IncomingMessage, response: ServerResponse, path: string, options: ManagedAccessApiOptions): Promise<boolean> {
  if (!agentRoute(path) && !ownerRecoveryRoute(path) && !ownerFileRoute(path) && path !== "/agent-access" && !path.startsWith("/agent-access/")) return false;
  const store = options.managedAccessStore;
  if (ownerRecoveryRoute(path)) {
    const service = options.managedRecoveryService;
    if (!service) { reject(response, 503, "recovery_unavailable"); return true; }
    try {
      if (path === "/owner/recovery/inspect" && request.method === "POST") { send(response, 200, await service.inspect(await body(request))); return true; }
      if (path === "/owner/recovery/backup" && request.method === "POST") { send(response, 200, await service.backup(await body(request))); return true; }
      if (path === "/owner/recovery/plan" && request.method === "POST") { send(response, 200, await service.plan(await body(request))); return true; }
      if (path === "/owner/recovery/apply" && request.method === "POST") { send(response, 200, await service.apply(await body(request))); return true; }
      const status = /^\/owner\/recovery\/status\/([^/]+)$/.exec(path);
      if (status && request.method === "GET") { send(response, 200, await service.status({ operation_ref: decodeURIComponent(status[1]!) })); return true; }
      reject(response, 405, "recovery_method_not_allowed"); return true;
    } catch (error) {
      const code = error instanceof ManagedAccessError ? error.code : error instanceof Error ? error.message : "recovery_unavailable";
      reject(response, code === "recovery_input_invalid" || code.endsWith("_invalid") ? 400 : 409, code); return true;
    }
  }
  if (ownerFileRoute(path)) {
    const service = options.managedFileService;
    if (!service) { reject(response, 503, "managed_file_unavailable"); return true; }
    try {
      if (path === "/owner/files" && request.method === "GET") {
        const requestUrl = new URL(request.url ?? "/owner/files", "http://127.0.0.1");
        send(response, 200, { ok: true, files: await service.inspect(requestUrl.searchParams.get("file_ref") ?? undefined) }); return true;
      }
      if (path === "/owner/files/import" && request.method === "POST") { send(response, 201, { ok: true, file: await service.importFile(await body(request)) }); return true; }
      if (path === "/owner/files/export" && request.method === "POST") { send(response, 200, { ok: true, file: await service.exportFile(await body(request)) }); return true; }
      if ((path === "/owner/files/revoke" || path === "/owner/files/delete") && request.method === "POST") {
        const input = await body(request);
        if (Object.keys(input).length !== 1 || typeof input.file_ref !== "string") throw new ManagedAccessError("managed_access_invalid_input");
        const file = path.endsWith("/revoke") ? await service.revoke(input.file_ref) : await service.delete(input.file_ref);
        send(response, 200, { ok: true, file }); return true;
      }
      reject(response, 405, "managed_file_method_not_allowed"); return true;
    } catch (error) {
      const code = error instanceof ManagedAccessError ? error.code : error instanceof Error ? error.message : "managed_file_unavailable";
      reject(response, code.endsWith("_invalid") ? 400 : code === "file_ref_unavailable" || code === "file_source_missing" || code === "file_expired" ? 404 : 409, code); return true;
    }
  }
  if (!store) { reject(response, 503, "managed_access_unavailable"); return true; }
  try {
    if (agentRoute(path)) {
      const token = bearer(request);
      if (!token) { reject(response, 401, "managed_access_authentication_required"); return true; }
      const credentialHash = createHash("sha256").update(token).digest("hex");
      await store.authenticateCredential(credentialHash);
      if (path === "/agent-connections" && request.method === "POST") {
        send(response, 201, { ok: true, connection: await store.connect(credentialHash), grants: await store.listAgentGrants(credentialHash) }); return true;
      }
      if (path === "/managed-browser/capabilities/describe" && request.method === "POST") {
        const service = options.managedBrowserService;
        if (!service?.describe) { reject(response, 503, "managed_browser_unavailable"); return true; }
        send(response, 200, await service.describe(credentialHash, await body(request))); return true;
      }
      if (path === "/managed-browser/operations" && request.method === "POST") {
        const service = options.managedBrowserService;
        if (!service) { reject(response, 503, "managed_browser_unavailable"); return true; }
        send(response, 200, await service.submit(credentialHash, await body(request))); return true;
      }
      const operation = /^\/managed-browser\/operations\/([^/]+)$/.exec(path);
      if (operation && request.method === "GET") {
        const service = options.managedBrowserService;
        if (!service) { reject(response, 503, "managed_browser_unavailable"); return true; }
        send(response, 200, await service.query(credentialHash, decodeURIComponent(operation[1]!))); return true;
      }
      if (path === "/managed-skills/operations" && request.method === "POST") {
        const service = options.managedSkillService;
        if (!service) { reject(response, 503, "managed_skill_unavailable"); return true; }
        send(response, 200, await service.submit(credentialHash, await body(request))); return true;
      }
      if (path === "/managed-tasks/operations" && request.method === "POST") {
        const service = options.managedTaskService;
        if (!service) { reject(response, 503, "managed_task_unavailable"); return true; }
        send(response, 200, await service.operate(credentialHash, await body(request, 128 * 1024, "managed_task_invalid_input"))); return true;
      }
      const skillOperation = /^\/managed-skills\/operations\/([^/]+)$/.exec(path);
      if (skillOperation && request.method === "GET") {
        const service = options.managedSkillService;
        if (!service) { reject(response, 503, "managed_skill_unavailable"); return true; }
        send(response, 200, await service.query(credentialHash, decodeURIComponent(skillOperation[1]!))); return true;
      }
      if (path === "/managed-tasks/operations") { reject(response, 405, "managed_task_method_not_allowed"); return true; }
    } else {
      if (path === "/agent-access/management-policy" && (request.method === "GET" || request.method === "PUT")) {
        const service = options.managedBrowserService;
        if (!service?.getManagementPolicy || !service.putManagementPolicy) { reject(response, 503, "managed_browser_unavailable"); return true; }
        const configuration = request.method === "GET" ? await service.getManagementPolicy() : await service.putManagementPolicy(await body(request));
        send(response, 200, { ok: true, configuration }); return true;
      }
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
      if (path === "/agent-access/v2/grants" && request.method === "POST") {
        send(response, 201, { ok: true, grant: await store.issueAgentOperationsV2Grant(await body(request)) }); return true;
      }
      if (path === "/agent-access/scope-confirmations" && request.method === "POST") {
        send(response, 201, { ok: true, ...await store.confirmAgentOperationsV2(await body(request)) }); return true;
      }
      if (path === "/agent-access/profile-policies" && request.method === "POST") {
        send(response, 200, { ok: true, profile_policy: await store.setProfilePolicy(await body(request)) }); return true;
      }
      if (path === "/agent-access/v2/profile-policies" && request.method === "POST") {
        send(response, 200, { ok: true, profile_policy: await store.updateAgentOperationsV2ProfilePolicy(await body(request)) }); return true;
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
    if (error instanceof ExecutionPolicyVersionConflictError) {
      send(response, 409, { ok: false, error: { code: error.message }, current: error.current ?? null }); return true;
    }
    if (path === "/agent-access/management-policy" && error instanceof Error && /^execution_policy_|^expected_source_version_invalid$/.test(error.message)) {
      reject(response, error.message.endsWith("_invalid") && error.message !== "execution_policy_store_invalid" ? 400 : error.message.endsWith("_conflict") ? 409 : 503, error.message); return true;
    }
    const code = error instanceof ManagedAccessError ? error.code : "managed_access_unavailable";
    // submit returns admitted Run failures itself; access errors escaping it precede dispatch.
    const managedTaskRequest = path === "/managed-tasks/operations" && request.method === "POST";
    const notDispatched = (path === "/managed-browser/operations" && request.method === "POST" || managedTaskRequest) && error instanceof ManagedAccessError && (code.startsWith("managed_access_") || code.startsWith("managed_task_"));
    const conflict = code === "managed_access_idempotency_conflict" || code === "managed_access_scope_conflict" || code === "managed_access_grant_conflict" || code === "managed_access_policy_conflict";
    const managedTaskStatus = managedTaskRequest
      ? code === "managed_task_operation_unavailable" ? 404
        : code === "managed_task_invalid_input" || code === "managed_task_version_unsupported" ? 400
          : ["managed_access_authentication_required", "managed_access_invalid_credential", "managed_access_connection_unavailable"].includes(code) ? 401
            : code === "managed_access_denied" ? 403
              : conflict ? 409
                : error instanceof ManagedAccessError ? 403 : 503
      : undefined;
    const isDiscovery = path === "/managed-browser/capabilities/describe" && request.method === "POST";
    const discoveryStatus: number | undefined = isDiscovery ? (code === "discovery_context_unavailable" ? 404 : code === "discovery_context_not_supported" || code === "managed_browser_invalid_input" ? 400 : ["managed_access_connection_unavailable", "managed_access_authentication_required", "managed_access_invalid_credential"].includes(code) ? 401 : ["managed_browser_runtime_refused", "runtime_facts_unavailable", "execution_policy_unavailable"].includes(code) ? 503 : undefined) : undefined;
    reject(response, managedTaskStatus ?? discoveryStatus ?? (code === "managed_access_authentication_required" ? 401 : code === "managed_access_invalid_input" || code === "managed_access_invalid_credential" || code === "managed_skill_invalid_input" ? 400 : conflict ? 409 : error instanceof ManagedAccessError ? 403 : 503), code, notDispatched);
  }
  return true;
}
