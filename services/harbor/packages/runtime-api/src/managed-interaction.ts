import type { LocalProviderPageFacts } from "./runtime-session-types.js";

export type ManagedInteractionInput = {
  action: "snapshot" | "click" | "input" | "press" | "scroll" | "wait";
  expected_origin: string;
  /** Core-derived Profile ∩ Grant ∩ task ∩ Runtime origin set. */
  authorized_origins?: readonly string[];
  control_generation: number;
  page_ref?: string;
  observation_ref?: string;
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
  page_ref: string;
  observation_ref: string;
  controls: { target_ref: string; role: string; name: string; enabled: boolean; value?: string }[];
  text: string;
  truncated: boolean;
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
