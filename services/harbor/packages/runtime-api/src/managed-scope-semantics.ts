export const MANAGED_SCOPE_SEMANTICS = ["legacy_request_guard_v1", "agent_operations_v2"] as const;
export type ManagedScopeSemantics = typeof MANAGED_SCOPE_SEMANTICS[number];

export function managedScopeSemantics(value: unknown): ManagedScopeSemantics | null {
  if (value === undefined) return "legacy_request_guard_v1";
  return MANAGED_SCOPE_SEMANTICS.includes(value as ManagedScopeSemantics) ? value as ManagedScopeSemantics : null;
}
