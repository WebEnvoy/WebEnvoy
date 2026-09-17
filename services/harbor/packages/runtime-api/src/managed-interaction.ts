import type { LocalProviderPageFacts } from "./runtime-session-types.js";
import type { ManagedScopeSemantics } from "./managed-scope-semantics.js";

export type ManagedInteractionInput = {
  action: "snapshot" | "click" | "input" | "press" | "scroll" | "wait";
  expected_origin: string;
  /** Core-derived Profile ∩ Grant ∩ task ∩ Runtime origin set. */
  authorized_origins?: readonly string[];
  /** Core-derived scope semantics; never accepted from the Agent route. */
  scope_semantics?: ManagedScopeSemantics;
  control_generation: number;
  page_id?: string;
  document_generation?: number;
  page_ref?: string;
  observation_ref?: string;
  /** Opaque Harbor cursor for a frozen instance.snapshot batch. */
  cursor?: string;
  /** Snapshot segment size; only instance.snapshot accepts this field. */
  limit?: number;
  target_ref?: string;
  text?: string;
  key?: string;
  delta_y?: number;
  wait_for?: "page_changed" | "text" | "enabled";
  timeout_ms?: number;
  /** Harbor-only provider selector; never accepted from the Agent route. */
  provider_page_ref?: string;
};
export type ManagedInteractionSnapshot = {
  /** Required on the public projection; optional internally for old fixtures. */
  schema_version?: "harbor-observation-targets/v1";
  page_id?: string;
  page_ref: string;
  document_generation?: number;
  observation_ref: string;
  captured_at?: string;
  controls: {
    target_ref: string;
    role: string;
    name: string;
    enabled: boolean;
    name_source?: string;
    description?: string | null;
    context?: { kind: string; name: string }[];
    hints?: { placeholder?: string | null; input_type?: string | null; multiline?: boolean | null; editable?: boolean | null };
    disambiguation?: "unique" | "contextual" | "ambiguous";
    truncated_fields?: string[];
    value?: string;
  }[];
  text: string;
  truncated: boolean;
  coverage?: {
    scope: string;
    excluded: string[];
    controls: {
      enumeration_complete: boolean;
      captured_count: number;
      total: number | null;
      returned_through: number;
      complete: boolean;
      reason_codes: string[];
    };
    text: { state: "complete" | "truncated" | "omitted_on_continuation" | "unavailable"; returned_bytes: number };
    semantics: { complete: boolean; reason_codes: string[] };
  };
  continuation?: { offset: number; returned_count: number; has_more: boolean; next_cursor: string | null };
};
export type ManagedInteractionResult = {
  status: "completed" | "unavailable" | "unknown_outcome";
  dispatch_state: "not_dispatched" | "dispatched";
  failure_class?: string;
  page?: LocalProviderPageFacts;
  snapshot?: ManagedInteractionSnapshot;
};
export type ManagedInteractionOperation = (input: ManagedInteractionInput) => Promise<ManagedInteractionResult>;
const trusted = new WeakSet<ManagedInteractionOperation>();
export function trustManagedInteractionOperation(operation: ManagedInteractionOperation): ManagedInteractionOperation {
  trusted.add(operation);
  return operation;
}
export function isTrustedManagedInteractionOperation(operation: ManagedInteractionOperation | undefined): operation is ManagedInteractionOperation {
  return operation !== undefined && trusted.has(operation);
}
