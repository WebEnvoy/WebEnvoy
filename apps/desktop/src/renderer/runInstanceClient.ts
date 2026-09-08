import { requestOwnerJson } from "./ownerApiClient";
import { fixtureOrDemoPayloadReason } from "./ownerPayloadGuards";

export type RunInstance = {
  runtimeSessionRef: string;
  profileRef: string;
  identityEnvironmentRef?: string;
  executionIdentityRef?: string;
  lifecycle: string;
  controlOwner: string;
  controlState: string;
  pageStatus: string;
  observedAt: string;
};
export type RunInstanceState = { status: "loading" } | { status: "unavailable"; summary: string } | { status: "ready"; instance: RunInstance };

export async function fetchRunInstance(coreEndpoint: string, harborEndpoint: string, runId: string, signal?: AbortSignal): Promise<RunInstanceState> {
  try {
    const response = await requestOwnerJson(coreEndpoint, `/runs/${encodeURIComponent(runId)}/session-refs`, { signal });
    const envelope = record(response);
    const query = record(envelope?.session_refs);
    const refs = record(query?.session_refs);
    const sessionRef = refs?.runtime_session_ref;
    if (envelope?.ok !== true || query?.schema_version !== "webenvoy.session-refs-query.v0" || query.run_id !== runId ||
        refs?.raw_access !== "not_available_from_core" || !safeRef(sessionRef) || fixtureOrDemoPayloadReason(response)) {
      return { status: "unavailable", summary: "当前回合未提供可核验的 Instance 引用。" };
    }
    const session = await requestOwnerJson(harborEndpoint, `/runtime/sessions/${encodeURIComponent(sessionRef)}`, { signal });
    return projectRunInstance(refs, session);
  } catch {
    return { status: "unavailable", summary: "无法读取当前回合的 Instance；请刷新检查。" };
  }
}

export function projectRunInstance(refs: Record<string, unknown>, value: unknown): RunInstanceState {
  const session = record(value);
  const control = record(session?.control_lock);
  const page = record(session?.current_page);
  if (!session || session.schema_version !== "harbor-runtime-facts/v0" || fixtureOrDemoPayloadReason(value) ||
      !safeRef(session.runtime_session_ref) || session.runtime_session_ref !== refs.runtime_session_ref ||
      !safeRef(session.profile_ref) || (refs.profile_ref !== undefined && refs.profile_ref !== session.profile_ref) ||
      ["identity_environment_ref", "execution_identity_ref"].some((key) => refs[key] !== undefined && refs[key] !== session[key]) ||
      typeof session.lifecycle_state !== "string" || typeof session.control_owner !== "string" ||
      typeof control?.state !== "string" || typeof page?.status !== "string") {
    return { status: "unavailable", summary: "Harbor 现场与本回合绑定不匹配或已不可用；不能据此确认继续。" };
  }
  return { status: "ready", instance: {
    runtimeSessionRef: session.runtime_session_ref,
    profileRef: session.profile_ref,
    ...(safeRef(session.identity_environment_ref) ? { identityEnvironmentRef: session.identity_environment_ref } : {}),
    ...(safeRef(session.execution_identity_ref) ? { executionIdentityRef: session.execution_identity_ref } : {}),
    lifecycle: session.lifecycle_state, controlOwner: session.control_owner, controlState: control.state,
    pageStatus: page.status, observedAt: typeof page.observed_at === "string" ? page.observed_at : "未提供",
  } };
}
function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
function safeRef(value: unknown): value is string {
  return typeof value === "string" && value.length <= 512 && /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(value) && !value.includes("://");
}
