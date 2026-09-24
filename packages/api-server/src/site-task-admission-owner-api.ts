import type { FileManagedSiteTaskAdmissionStore } from "@webenvoy/core-runtime";
import { ManagedAccessError } from "@webenvoy/core-runtime";
import type { IncomingMessage, ServerResponse } from "node:http";

export type SiteTaskAdmissionOwnerApiService = Pick<FileManagedSiteTaskAdmissionStore,
  "selectAuthoringRepository" | "listAuthoringRepositories" | "inspectCandidate" | "candidateDiff" | "admitSource" | "admitCode" | "revokeCode" | "revokeSource" | "listAdmissions">;

const routePath = "/owner/site-task-admissions/operations";

function send(response: ServerResponse, statusCode: number, value: unknown): void {
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(`${JSON.stringify(value)}\n`);
}
async function body(request: IncomingMessage): Promise<Record<string, unknown>> {
  if (request.headers["content-type"]?.split(";")[0]?.trim().toLowerCase() !== "application/json") throw new ManagedAccessError("managed_site_task_admission_invalid_input");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > 64 * 1024) throw new ManagedAccessError("managed_site_task_admission_invalid_input");
    chunks.push(bytes);
  }
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    return parsed as Record<string, unknown>;
  } catch { throw new ManagedAccessError("managed_site_task_admission_invalid_input"); }
}
function exact(input: Record<string, unknown>, required: string[], optional: string[] = []): void {
  if (required.some(key => !Object.hasOwn(input, key)) || Object.keys(input).some(key => !required.includes(key) && !optional.includes(key))) {
    throw new ManagedAccessError("managed_site_task_admission_invalid_input");
  }
}
function status(code: string): number {
  if (code.endsWith("_invalid_input") || code.endsWith("_source_corrupt") || code.endsWith("_script_syntax_invalid")) return 400;
  if (code.endsWith("_unavailable") || code.endsWith("_missing")) return 404;
  if (code.endsWith("_store_invalid") || code.endsWith("_store_unavailable")) return 503;
  return 409;
}

/** Owner-only local Git source and code admission lifecycle for managed site tasks. */
export async function handleSiteTaskAdmissionOwnerApi(
  request: IncomingMessage,
  response: ServerResponse,
  path: string,
  service?: SiteTaskAdmissionOwnerApiService
): Promise<boolean> {
  if (path !== routePath) return false;
  if (request.method !== "POST") {
    send(response, 405, { ok: false, error: { code: "managed_site_task_admission_method_not_allowed" } });
    return true;
  }
  if (!service) {
    send(response, 503, { ok: false, error: { code: "managed_site_task_admission_unavailable" } });
    return true;
  }
  try {
    const input = await body(request);
    if (input.schema_version !== "webenvoy.site-task-admission-owner-operation/v1" || typeof input.operation !== "string") throw new ManagedAccessError("managed_site_task_admission_invalid_input");
    switch (input.operation) {
      case "select_authoring_repository":
        exact(input, ["schema_version", "operation", "path"]);
        send(response, 201, { ok: true, result: await service.selectAuthoringRepository({ path: input.path }) });
        return true;
      case "list_authoring_repositories":
        exact(input, ["schema_version", "operation"]);
        send(response, 200, { ok: true, result: await service.listAuthoringRepositories() });
        return true;
      case "inspect_candidate":
        exact(input, ["schema_version", "operation", "repository_ref", "package_ref", "base_revision_ref", "task_ref"]);
        send(response, 200, { ok: true, result: await service.inspectCandidate({ repository_ref: input.repository_ref, package_ref: input.package_ref, base_revision_ref: input.base_revision_ref, task_ref: input.task_ref }) });
        return true;
      case "candidate_diff":
        exact(input, ["schema_version", "operation", "candidate_ref"]);
        send(response, 200, { ok: true, result: await service.candidateDiff({ candidate_ref: input.candidate_ref }) });
        return true;
      case "admit_source":
        exact(input, ["schema_version", "operation", "candidate_ref"]);
        send(response, 200, { ok: true, result: await service.admitSource({ candidate_ref: input.candidate_ref }) });
        return true;
      case "admit_code":
        exact(input, ["schema_version", "operation", "admission_ref"]);
        send(response, 200, { ok: true, result: await service.admitCode({ admission_ref: input.admission_ref }) });
        return true;
      case "revoke_code":
        exact(input, ["schema_version", "operation", "admission_ref"]);
        send(response, 200, { ok: true, result: await service.revokeCode({ admission_ref: input.admission_ref }) });
        return true;
      case "revoke_source":
        exact(input, ["schema_version", "operation", "admission_ref"]);
        send(response, 200, { ok: true, result: await service.revokeSource({ admission_ref: input.admission_ref }) });
        return true;
      case "list_admissions":
        exact(input, ["schema_version", "operation"], ["package_ref"]);
        send(response, 200, { ok: true, result: await service.listAdmissions(input.package_ref as string | undefined) });
        return true;
      default:
        throw new ManagedAccessError("managed_site_task_admission_invalid_input");
    }
  } catch (error) {
    const code = error instanceof ManagedAccessError ? error.code : "managed_site_task_admission_unavailable";
    send(response, status(code), { ok: false, error: { code } });
    return true;
  }
}
