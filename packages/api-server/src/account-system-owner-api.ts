import type { FileAccountSystemDefinitionStore } from "@webenvoy/core-runtime";
import { ManagedAccessError } from "@webenvoy/core-runtime";
import type { IncomingMessage, ServerResponse } from "node:http";

export type AccountSystemOwnerApiService = Pick<FileAccountSystemDefinitionStore,
  "importTemplate" | "list" | "createDraft" | "updateDraft" | "checkDraft" | "pinDraft" | "enable" | "disable" | "rollback" | "resolve">;

const routePath = "/owner/account-systems/operations";

function send(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(`${JSON.stringify(value)}\n`);
}

async function body(request: IncomingMessage): Promise<Record<string, unknown>> {
  if (request.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") {
    throw new ManagedAccessError("account_system_invalid_input");
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > 64 * 1024) throw new ManagedAccessError("account_system_invalid_input");
    chunks.push(bytes);
  }
  let parsed: unknown;
  try { parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new ManagedAccessError("account_system_invalid_input"); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new ManagedAccessError("account_system_invalid_input");
  return parsed as Record<string, unknown>;
}

function exactInput(input: Record<string, unknown>, required: string[], optional: string[] = []): void {
  if (required.some(field => !Object.hasOwn(input, field)) || Object.keys(input).some(field => !required.includes(field) && !optional.includes(field))) {
    throw new ManagedAccessError("account_system_invalid_input");
  }
}

function invalidStatus(code: string): number {
  if (code === "account_system_invalid_input" || code === "account_system_invalid_definition" || code === "account_system_template_corrupt") return 400;
  if (code.endsWith("_unavailable") || code.endsWith("_not_approved")) return 404;
  if (code.endsWith("_store_invalid")) return 503;
  return 409;
}

/** Owner-only API for importing and managing Core-local public AccountSystem definitions. */
export async function handleAccountSystemOwnerApi(
  request: IncomingMessage,
  response: ServerResponse,
  path: string,
  service?: AccountSystemOwnerApiService
): Promise<boolean> {
  if (path !== routePath) return false;
  if (request.method !== "POST") {
    send(response, 405, { ok: false, error: { code: "account_system_method_not_allowed" } });
    return true;
  }
  if (!service) {
    send(response, 503, { ok: false, error: { code: "account_system_unavailable" } });
    return true;
  }
  try {
    const input = await body(request);
    if (input.schema_version !== "webenvoy.account-system-owner-operation/v1") throw new ManagedAccessError("account_system_invalid_input");
    delete input.schema_version;
    if (typeof input.operation !== "string") throw new ManagedAccessError("account_system_invalid_input");
    let result: unknown;
    switch (input.operation) {
      case "import_template":
        exactInput(input, ["operation", "template_ref"]);
        result = await service.importTemplate({ template_ref: input.template_ref as string });
        break;
      case "list":
        exactInput(input, ["operation"]);
        result = { definitions: await service.list() };
        break;
      case "create_draft":
        exactInput(input, ["operation", "local_definition_ref", "base_revision_ref"]);
        result = await service.createDraft({ local_definition_ref: input.local_definition_ref as string, base_revision_ref: input.base_revision_ref as string });
        break;
      case "update_draft":
        exactInput(input, ["operation", "draft_ref", "definition"]);
        result = await service.updateDraft({ draft_ref: input.draft_ref as string, definition: input.definition });
        break;
      case "check_draft":
        exactInput(input, ["operation", "draft_ref"]);
        result = await service.checkDraft({ draft_ref: input.draft_ref as string });
        break;
      case "pin_draft":
        exactInput(input, ["operation", "draft_ref", "expected_record_version"]);
        result = await service.pinDraft({ draft_ref: input.draft_ref as string, expected_record_version: input.expected_record_version as number });
        break;
      case "enable":
        exactInput(input, ["operation", "local_definition_ref", "revision_ref", "expected_record_version"]);
        result = await service.enable({ local_definition_ref: input.local_definition_ref as string, revision_ref: input.revision_ref as string, expected_record_version: input.expected_record_version as number });
        break;
      case "disable":
        exactInput(input, ["operation", "local_definition_ref", "expected_record_version"]);
        result = await service.disable({ local_definition_ref: input.local_definition_ref as string, expected_record_version: input.expected_record_version as number });
        break;
      case "rollback":
        exactInput(input, ["operation", "local_definition_ref", "revision_ref", "expected_record_version"]);
        result = await service.rollback({ local_definition_ref: input.local_definition_ref as string, revision_ref: input.revision_ref as string, expected_record_version: input.expected_record_version as number });
        break;
      case "resolve":
        exactInput(input, ["operation", "local_definition_ref"], ["revision_ref", "historical"]);
        if (input.historical !== undefined && typeof input.historical !== "boolean") throw new ManagedAccessError("account_system_invalid_input");
        if (input.historical === true && typeof input.revision_ref !== "string") throw new ManagedAccessError("account_system_invalid_input");
        result = await service.resolve(input.local_definition_ref as string, input.revision_ref as string | undefined, input.historical === true ? { historical: true } : undefined);
        break;
      default:
        throw new ManagedAccessError("account_system_invalid_input");
    }
    send(response, 200, { ok: true, result });
  } catch (error) {
    const code = error instanceof ManagedAccessError ? error.code : "account_system_unavailable";
    send(response, invalidStatus(code), { ok: false, error: { code } });
  }
  return true;
}
