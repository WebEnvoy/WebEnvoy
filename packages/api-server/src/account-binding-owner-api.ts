import { ManagedAccessError } from "@webenvoy/core-runtime";
import type { IncomingMessage, ServerResponse } from "node:http";

export type AccountBindingOwnerRequest = {
  identity_environment_ref: string;
  profile_ref: string;
  runtime_session_ref: string;
  observation_ref: string;
  account_system_ref: string;
  account_ref: string;
  idempotency_key: string;
};

export type AccountBindingOwnerApiService = {
  inspect(identity_environment_ref: string): Promise<unknown>;
  bind(input: AccountBindingOwnerRequest): Promise<unknown>;
};

const routePath = "/owner/account-bindings/operations";
const textRef = /^[A-Za-z0-9:_./-]{1,256}$/;
const accountSystemRef = /^account-system:[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const accountRef = /^account:sha256:[a-f0-9]{64}$/;

function send(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(`${JSON.stringify(value)}\n`);
}

async function body(request: IncomingMessage): Promise<Record<string, unknown>> {
  if (request.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") {
    throw new ManagedAccessError("account_binding_invalid_input");
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > 64 * 1024) throw new ManagedAccessError("account_binding_invalid_input");
    chunks.push(bytes);
  }
  let parsed: unknown;
  try { parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new ManagedAccessError("account_binding_invalid_input"); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new ManagedAccessError("account_binding_invalid_input");
  return parsed as Record<string, unknown>;
}

function exactInput(input: Record<string, unknown>, required: string[]): void {
  if (required.some(field => !Object.hasOwn(input, field)) || Object.keys(input).some(field => !required.includes(field))) {
    throw new ManagedAccessError("account_binding_invalid_input");
  }
}

function validTextRef(value: unknown): value is string {
  return typeof value === "string" && textRef.test(value);
}

function errorStatus(code: string): number {
  if (code === "account_binding_invalid_input") return 400;
  if (code === "identity_environment_missing" || code === "account_binding_session_missing") return 404;
  if (code === "account_binding_unavailable" || code === "account_binding_record_malformed") return 503;
  return 409;
}

/** Core owner-only API for explicit binding of an existing Harbor-verified observation. */
export async function handleAccountBindingOwnerApi(
  request: IncomingMessage,
  response: ServerResponse,
  path: string,
  service?: AccountBindingOwnerApiService
): Promise<boolean> {
  if (path !== routePath) return false;
  if (request.method !== "POST") {
    send(response, 405, { ok: false, error: { code: "account_binding_method_not_allowed" } });
    return true;
  }
  if (!service) {
    send(response, 503, { ok: false, error: { code: "account_binding_unavailable" } });
    return true;
  }
  try {
    const input = await body(request);
    if (input.schema_version !== "webenvoy.account-binding-owner-operation/v1" || typeof input.operation !== "string") {
      throw new ManagedAccessError("account_binding_invalid_input");
    }
    if (input.operation === "inspect") {
      exactInput(input, ["schema_version", "operation", "identity_environment_ref"]);
      if (!validTextRef(input.identity_environment_ref)) throw new ManagedAccessError("account_binding_invalid_input");
      send(response, 200, { ok: true, result: await service.inspect(input.identity_environment_ref) });
      return true;
    }
    if (input.operation === "bind") {
      exactInput(input, ["schema_version", "operation", "identity_environment_ref", "profile_ref", "runtime_session_ref", "observation_ref", "account_system_ref", "account_ref", "idempotency_key", "confirm"]);
      if (!validTextRef(input.identity_environment_ref) || !validTextRef(input.profile_ref) ||
          !validTextRef(input.runtime_session_ref) || !validTextRef(input.observation_ref) ||
          typeof input.account_system_ref !== "string" || !accountSystemRef.test(input.account_system_ref) ||
          typeof input.account_ref !== "string" || !accountRef.test(input.account_ref) ||
          !validTextRef(input.idempotency_key) || input.confirm !== true) {
        throw new ManagedAccessError("account_binding_invalid_input");
      }
      const result = await service.bind({
        identity_environment_ref: input.identity_environment_ref,
        profile_ref: input.profile_ref,
        runtime_session_ref: input.runtime_session_ref,
        observation_ref: input.observation_ref,
        account_system_ref: input.account_system_ref,
        account_ref: input.account_ref,
        idempotency_key: input.idempotency_key
      });
      send(response, 200, { ok: true, result });
      return true;
    }
    throw new ManagedAccessError("account_binding_invalid_input");
  } catch (error) {
    const code = error instanceof ManagedAccessError && /^[a-z0-9_]{1,96}$/.test(error.code)
      ? error.code
      : "account_binding_unavailable";
    send(response, errorStatus(code), { ok: false, error: { code } });
  }
  return true;
}

type HttpOwnerServiceOptions = { baseUrl: string; supervisorToken: string; fetch?: typeof fetch };
type JsonObject = Record<string, unknown>;

function object(value: unknown): JsonObject | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : undefined;
}

function harborErrorCode(value: unknown): string | undefined {
  const record = object(value);
  const code = typeof record?.failure_class === "string" ? record.failure_class : record?.error;
  return typeof code === "string" && /^[a-z0-9_]{1,96}$/.test(code) ? code : undefined;
}

const safeHarborErrors = new Set([
  "identity_environment_missing", "session_missing", "session_not_ready", "control_lock_conflict", "control_changed",
  "account_observation_required", "account_observation_changed", "account_binding_conflict", "idempotency_conflict",
  "invalid_request", "persistence_failed", "account_binding_unavailable"
]);

/** Internal Core-to-Harbor bridge; the Harbor supervisor credential never enters the owner wire. */
export function createHttpAccountBindingOwnerApiService(options: HttpOwnerServiceOptions): AccountBindingOwnerApiService {
  const base = new URL(options.baseUrl);
  if (!["http:", "https:"].includes(base.protocol) || base.username || base.password || base.search || base.hash) {
    throw new Error("account_binding_harbor_url_invalid");
  }
  if (!/^[A-Za-z0-9_-]{32,512}$/.test(options.supervisorToken)) throw new Error("account_binding_harbor_supervisor_unavailable");
  const fetchJson = options.fetch ?? fetch;

  async function request(path: string, method: "GET" | "POST", input?: JsonObject): Promise<JsonObject> {
    try {
      const response = await fetchJson(new URL(path, base), {
        method,
        headers: { authorization: `Bearer ${options.supervisorToken}`, "content-type": "application/json" },
        ...(input === undefined ? {} : { body: JSON.stringify(input) }),
        signal: AbortSignal.timeout(30_000)
      });
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength > 1024 * 1024) throw new ManagedAccessError("account_binding_unavailable");
      let value: unknown;
      try { value = JSON.parse(new TextDecoder().decode(bytes)); }
      catch { throw new ManagedAccessError("account_binding_unavailable"); }
      const record = object(value);
      if (!record) throw new ManagedAccessError("account_binding_unavailable");
      if (!response.ok) {
        const code = harborErrorCode(record);
        throw new ManagedAccessError(code && safeHarborErrors.has(code) ? code : "account_binding_unavailable");
      }
      return record;
    } catch (error) {
      if (error instanceof ManagedAccessError) throw error;
      throw new ManagedAccessError("account_binding_unavailable");
    }
  }

  function projectBindings(identity_environment_ref: string, value: JsonObject): JsonObject {
    const bindings = value.account_bindings;
    const site = object(value.site);
    if (value.identity_environment_ref !== identity_environment_ref || !Array.isArray(bindings) || !site) {
      throw new ManagedAccessError("account_binding_record_malformed");
    }
    const projected = bindings.map(item => {
      const binding = object(item);
      if (!binding || typeof binding.account_system_ref !== "string" || !accountSystemRef.test(binding.account_system_ref) ||
          typeof binding.account_ref !== "string" || !accountRef.test(binding.account_ref) || !validTextRef(binding.observation_ref) ||
          typeof binding.bound_at !== "string" || !Number.isFinite(Date.parse(binding.bound_at))) {
        throw new ManagedAccessError("account_binding_record_malformed");
      }
      return { account_system_ref: binding.account_system_ref, account_ref: binding.account_ref, observation_ref: binding.observation_ref, bound_at: binding.bound_at };
    });
    return {
      identity_environment_ref,
      account_bindings: projected,
      legacy_binding_present: typeof site.account_ref === "string" && site.account_ref.length > 0
    };
  }

  return {
    async inspect(identity_environment_ref) {
      const value = await request(`/runtime/identity-environments/${encodeURIComponent(identity_environment_ref)}`, "GET");
      return projectBindings(identity_environment_ref, value);
    },
    async bind(input) {
      const session = await request(`/runtime/sessions/${encodeURIComponent(input.runtime_session_ref)}`, "GET");
      const control = object(session.control_lock);
      const holder_ref = control?.holder_ref;
      if (session.runtime_session_ref !== input.runtime_session_ref || session.identity_environment_ref !== input.identity_environment_ref ||
          session.profile_ref !== input.profile_ref) throw new ManagedAccessError("account_binding_identity_mismatch");
      if (!control || session.control_owner !== "core_task" || control.owner !== "core_task" || control.state !== "held" ||
          !validTextRef(holder_ref) || !["active", "locked", "idle"].includes(String(session.lifecycle_state))) {
        throw new ManagedAccessError("account_binding_control_not_held");
      }
      const record = await request(`/runtime/identity-environments/${encodeURIComponent(input.identity_environment_ref)}/account-bindings`, "POST", {
        observation_ref: input.observation_ref,
        runtime_session_ref: input.runtime_session_ref,
        account_system_ref: input.account_system_ref,
        account_ref: input.account_ref,
        idempotency_key: input.idempotency_key,
        holder_ref
      });
      const projected = projectBindings(input.identity_environment_ref, record);
      const binding = (projected.account_bindings as JsonObject[]).find(item =>
        item.account_system_ref === input.account_system_ref && item.account_ref === input.account_ref);
      if (!binding) throw new ManagedAccessError("account_binding_record_malformed");
      return { identity_environment_ref: input.identity_environment_ref, profile_ref: input.profile_ref, account_binding: binding };
    }
  };
}
