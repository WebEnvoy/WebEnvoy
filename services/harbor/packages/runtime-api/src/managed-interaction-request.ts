import { boundedManagedRef, managedPublicOrigin } from "./managed-observation.js";
import type { ManagedInteractionInput } from "./managed-interaction.js";

export type ManagedInteractionRequest = Omit<ManagedInteractionInput, "control_generation"> & {
  holder_ref: string; operation_ref: string; controlled_origin: string;
};

// Only Core's supervisor route can carry the already checked owner declaration.
export function parseManagedInteractionRequest(value: unknown): ManagedInteractionRequest | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const common = ["action", "expected_origin", "authorized_origins", "controlled_origin", "holder_ref", "operation_ref"];
  const byAction: Record<string, string[]> = {
    snapshot: ["page_ref"], click: ["page_ref", "observation_ref", "target_ref"],
    input: ["page_ref", "observation_ref", "target_ref", "text"],
    press: ["page_ref", "observation_ref", "target_ref", "key"],
    scroll: ["page_ref", "observation_ref", "delta_y"],
    wait: ["page_ref", "observation_ref", "wait_for", "target_ref", "text", "timeout_ms"]
  };
  if (typeof input.action !== "string" || !Object.hasOwn(byAction, input.action)) return null;
  const actionFields = byAction[input.action]!;
  if (Object.keys(input).some(key => ![...common, ...actionFields].includes(key))) return null;
  if (!boundedManagedRef(input.holder_ref) || !boundedManagedRef(input.operation_ref) || !managedPublicOrigin(input.expected_origin) || input.controlled_origin !== input.expected_origin) return null;
  const authorizedOrigins = input.authorized_origins === undefined
    ? [input.expected_origin]
    : Array.isArray(input.authorized_origins) && input.authorized_origins.length > 0 && input.authorized_origins.length <= 64 &&
      input.authorized_origins.every(origin => managedPublicOrigin(origin))
      ? [...new Set(input.authorized_origins)]
      : null;
  // Core's fresh intersection is authoritative. The expected origin must be
  // a member of it; never widen an explicitly supplied set for compatibility.
  if (!authorizedOrigins || !authorizedOrigins.includes(input.expected_origin)) return null;
  if (input.page_ref !== undefined && !boundedManagedRef(input.page_ref)) return null;
  if (input.action !== "snapshot" && (!boundedManagedRef(input.page_ref) || !boundedManagedRef(input.observation_ref))) return null;
  if (["click", "input", "press"].includes(input.action) && !boundedManagedRef(input.target_ref)) return null;
  if (input.action === "input" && (typeof input.text !== "string" || input.text.length > 512 || /[\u0000-\u001f\u007f]/.test(input.text))) return null;
  if (input.action === "press" && !["Enter", "Tab", "ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Home", "End", "Space", "Backspace", "Delete", "Escape"].includes(String(input.key))) return null;
  if (input.action === "scroll" && (!Number.isSafeInteger(input.delta_y) || Math.abs(Number(input.delta_y)) > 2000 || input.delta_y === 0)) return null;
  if (input.action === "wait") {
    if (!["page_changed", "text", "enabled"].includes(String(input.wait_for))) return null;
    if (input.timeout_ms !== undefined && (!Number.isSafeInteger(input.timeout_ms) || Number(input.timeout_ms) < 1 || Number(input.timeout_ms) > 10_000)) return null;
    if (input.wait_for === "enabled" ? !boundedManagedRef(input.target_ref) : input.target_ref !== undefined) return null;
    if (input.wait_for === "text" ? typeof input.text !== "string" || !input.text.length || input.text.length > 256 || /[\u0000-\u001f\u007f]/.test(input.text) : input.text !== undefined) return null;
  }
  return { ...input, authorized_origins: authorizedOrigins } as unknown as ManagedInteractionRequest;
}
