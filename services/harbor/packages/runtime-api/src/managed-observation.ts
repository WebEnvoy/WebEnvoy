import { createHash } from "node:crypto";
import type { LocalProviderPageFacts } from "./runtime-session-types.js";

export const managedOperationCatalog = {
  schema_version: "webenvoy.harbor-operation-catalog.v0",
  catalog_ref: "harbor://managed-operations", catalog_version: "6",
  operations: [...["profile.list", "profile.read", "profile.create", "instance.start", "instance.stop", "instance.observe", "instance.diagnostics", "environment.read", "environment.update", "instance.navigate", "instance.read", "instance.handoff", "account.bind", "recovery.inspect", "recovery.request", "recovery.status", "page.list", "page.open", "page.activate", "page.close", "page.navigate", "page.reload", "page.back", "page.forward"].map(operation_id => ({
    operation_id, category: operation_id === "environment.update" || operation_id === "recovery.request" ? "prepare" : ["profile.create", "account.bind", "page.open", "page.activate", "page.close", "page.navigate", "page.reload", "page.back", "page.forward"].includes(operation_id) ? "prepare" : "read",
    target_scope: { target_types: ["managed_profile"] }, resource_requirement_refs: ["harbor://managed-profile"]
  })),
  ...["controlled-page.observe", "controlled-page.interact"].map(operation_id => ({
    operation_id, category: operation_id === "controlled-page.interact" ? "prepare" : "read",
    target_scope: { target_types: ["managed_profile"] }, resource_requirement_refs: ["harbor://managed-profile", "harbor://controlled-page"]
  }))]
};
export type DiscoveredManagedAccount = { status: "verified" | "unknown"; account_system_ref: string | null; account_ref: string | null };
export type ManagedProviderObservation = { page: LocalProviderPageFacts; account: DiscoveredManagedAccount };
export type ManagedObservation = {
  status: "completed"; observation_ref: string; observed_at: string; runtime_session_ref: string;
  identity_environment_ref: string; profile_ref: string; control_owner: string; control_generation: number;
  page: Pick<LocalProviderPageFacts, "current_url" | "title" | "status">; account: DiscoveredManagedAccount;
};
export type ManagedObservationUnavailable = { status: "unavailable"; failure_class: string; retryable: boolean };
export type ManagedAccountBinding = { account_system_ref: string; account_ref: string; observation_ref: string; bound_at: string };
export const unknownManagedAccount = (): DiscoveredManagedAccount => ({ status: "unknown", account_system_ref: null, account_ref: null });
export function managedUnavailable(failure_class: string): ManagedObservationUnavailable { return { status: "unavailable", failure_class, retryable: false }; }
export function boundedManagedRef(value: unknown): value is string { return typeof value === "string" && /^[A-Za-z0-9:_./-]{1,256}$/.test(value); }

// Fixed, read-only provider expression. Reuses the creator auth-store identity evidence:
// a single visible account label must agree with the stable authenticated store identity.
export const managedPageObservationExpression = `(() => {
  const visible = el => { const rect = el.getBoundingClientRect(); const style = getComputedStyle(el); return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none'; };
  let stable_id = null;
  if (location.origin === 'https://creator.xiaohongshu.com') {
    const app = document.querySelector('#app');
    const roots = app && visible(app) ? [...app.querySelectorAll('.user-info')].filter(visible) : [];
    const labels = roots.length === 1 ? [...roots[0].querySelectorAll('.name-box')].filter(visible).map(el => (el.innerText || el.textContent || '').trim()).filter(Boolean) : [];
    const unique = [...new Set(labels)];
    const user = app?.__vue_app__?.config?.globalProperties?.$store?.state?.Auth?.userInfo;
    if (unique.length === 1 && unique[0].length <= 96 && typeof user?.userName === 'string' && user.userName.trim() === unique[0] && typeof user?.userId === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(user.userId)) stable_id = user.userId;
  }
  return { current_url: location.origin + location.pathname, title: document.title.slice(0, 256), ready_state: document.readyState, stable_id };
})()`;
export function normalizeManagedProviderObservation(value: unknown): ManagedProviderObservation {
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
  let current_url: string | null = null;
  try {
    const parsed = new URL(String(raw.current_url));
    if (["https:", "http:"].includes(parsed.protocol) && !parsed.username && !parsed.password && parsed.pathname.length <= 1024) current_url = `${parsed.origin}${parsed.pathname}`;
  } catch { /* Unavailable URLs remain unknown. */ }
  const title = typeof raw.title === "string" && raw.title.length <= 256 && !/[\u0000-\u001f\u007f]|(?:token|cookie|password|secret|authorization)\s*[=:]/i.test(raw.title) ? raw.title : null;
  const ready = raw.ready_state === "complete" || raw.ready_state === "interactive";
  const verified = ready && current_url?.startsWith("https://creator.xiaohongshu.com/") && typeof raw.stable_id === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(raw.stable_id);
  return { page: { current_url, title, status: current_url && ready ? "ready" : "unknown", facts: [] }, account: verified
    ? { status: "verified", account_system_ref: "account-system:xiaohongshu", account_ref: `account:sha256:${createHash("sha256").update(JSON.stringify({ site_id: "xiaohongshu", stable_id: raw.stable_id })).digest("hex")}` }
    : unknownManagedAccount() };
}

type ObservePage = () => Promise<ManagedProviderObservation>;
const trustedObservers = new WeakSet<ObservePage>();
export function trustManagedPageObserver(observer: ObservePage): ObservePage { trustedObservers.add(observer); return observer; }
export function isTrustedManagedPageObserver(observer: ObservePage | undefined): observer is ObservePage { return observer !== undefined && trustedObservers.has(observer); }

export function effectiveManagedBindings(record: import("./identity-environment-manager.js").StoredLocalIdentityEnvironmentRecord): Pick<ManagedAccountBinding, "account_system_ref" | "account_ref">[] {
  const legacy = record.identity_environment.site_binding;
  return [...(record.account_bindings ?? []), ...(legacy.account_ref ? [{ account_system_ref: `account-system:${legacy.site_id}`, account_ref: legacy.account_ref }] : [])];
}
export function hasManagedBindingConflict(records: Iterable<import("./identity-environment-manager.js").StoredLocalIdentityEnvironmentRecord>, candidate: import("./identity-environment-manager.js").StoredLocalIdentityEnvironmentRecord): boolean {
  const bindings = effectiveManagedBindings(candidate);
  if (bindings.some((binding, index) => bindings.slice(0, index).some(other => binding.account_system_ref === other.account_system_ref && binding.account_ref !== other.account_ref))) return true;
  for (const record of records) {
    if (record.identity_environment.identity_environment_ref === candidate.identity_environment.identity_environment_ref) continue;
    if (effectiveManagedBindings(record).some(other => bindings.some(binding => binding.account_system_ref === other.account_system_ref && binding.account_ref === other.account_ref))) return true;
  }
  return false;
}

export type ManagedPublicPageInput = { expected_origin: string; url?: string };
export type ManagedPublicPageResult = { status: "completed"; page: LocalProviderPageFacts; text?: string; truncated?: boolean } | (ManagedObservationUnavailable & { page?: LocalProviderPageFacts });
export type ManagedPublicPageOperation = (input: ManagedPublicPageInput) => Promise<ManagedPublicPageResult>;
const trustedPublicOperations = new WeakSet<ManagedPublicPageOperation>();
export function trustManagedPublicPageOperation(operation: ManagedPublicPageOperation): ManagedPublicPageOperation { trustedPublicOperations.add(operation); return operation; }
export function isTrustedManagedPublicPageOperation(operation: ManagedPublicPageOperation | undefined): operation is ManagedPublicPageOperation { return operation !== undefined && trustedPublicOperations.has(operation); }

export function managedPublicOrigin(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && url.origin === value &&
      !/(^|\.)(xiaohongshu\.com|zhipin\.com)$/.test(url.hostname);
  } catch { return false; }
}
