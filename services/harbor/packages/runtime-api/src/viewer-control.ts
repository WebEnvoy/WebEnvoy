import { opaqueRef } from "./refs.js";
import type { RuntimeErrorFact } from "./runtime-session-types.js";

export const HARBOR_VIEWER_CONTROL_FACTS_SCHEMA = "harbor-viewer-control-facts/v0";
export const HARBOR_CORE_RUNTIME_FACTS_SCHEMA = "harbor-core-runtime-facts/v0";
export const HARBOR_APP_RUNTIME_STATUS_FIXTURE_SCHEMA = "harbor-app-runtime-status-fixture/v0";

export type AppBrowserStatus = "ready" | "unavailable" | "closed";
export type ControlOwner = "system" | "user" | "agent" | "core_task" | "app" | "provider" | "none" | "unknown";
export type HandoffReason =
  | "login_required"
  | "captcha_required"
  | "policy_requires_user"
  | "user_requested"
  | "automation_blocked"
  | "viewer_only"
  | "control_lost"
  | "provider_limit"
  | "unknown_outcome_risk";
export type InputCapability = "keyboard_mouse" | "clipboard" | "file_upload" | "download_view";
export type TakeoverUnavailableReason =
  | "viewer_unavailable"
  | "permission_denied"
  | "policy_denied"
  | "already_user_controlled"
  | "session_unavailable"
  | "unsupported";
export type ViewerAccessMode = "none" | "read_only" | "interactive" | "input_disabled";
export type ViewerAvailability = "available" | "unavailable" | "permission_denied" | "expired" | "unsupported";
export type ViewerControlFailureClass = "session_missing" | "viewer_unavailable" | "control_owner_unknown";
export type ViewerTransport = "not_applicable" | "local_window" | "remote_vnc" | "remote_browser_viewer";

export interface ViewerControlSessionFacts {
  runtime_session_ref: string;
  identity_environment_ref?: string;
  execution_identity_ref?: string;
  profile_ref: string;
  provider_ref: string;
  provider_mode: string;
  lifecycle_state: string;
  control_owner?: ControlOwner;
  viewer_entry?: {
    availability: ViewerAvailability;
    access_mode: ViewerAccessMode;
    transport: ViewerTransport;
    input_capabilities: InputCapability[];
    unavailable_reason?: TakeoverUnavailableReason;
  };
  availability: {
    cdp: string;
    viewer: string;
    snapshot: string;
    evidence: string;
  };
  current_error: RuntimeErrorFact | null;
  facts: unknown[];
}

export interface ViewerRefFacts {
  viewer_ref: string;
  viewer_url: string | null;
  availability: ViewerAvailability;
  access_mode: ViewerAccessMode;
  transport: ViewerTransport;
  input_capabilities: InputCapability[];
  access_boundary: "harbor_ref_only";
  created_at: string;
  expires_at: string;
  unavailable_reason?: TakeoverUnavailableReason;
}

export interface ControlOwnerFacts {
  owner: ControlOwner;
  previous_owner: ControlOwner | null;
  handoff_reason: HandoffReason | null;
  takeover: {
    available: boolean;
    unavailable_reason?: TakeoverUnavailableReason;
  };
  updated_at: string;
}

export interface ViewerControlFacts {
  schema_version: typeof HARBOR_VIEWER_CONTROL_FACTS_SCHEMA;
  runtime_session_ref: string;
  profile_ref: string;
  provider_ref: string;
  viewer: ViewerRefFacts;
  control: ControlOwnerFacts;
  privacy_boundary: {
    access_policy: "harbor_mediated_ref";
    raw_cdp_endpoint: "not_exposed";
    raw_vnc_endpoint: "not_exposed";
    browser_private_state: "not_exposed";
    auth_private_state: "not_exposed";
    full_profile_storage: "not_exposed";
  };
  unavailable: null;
}

export interface RecordHandoffInput {
  control_owner: ControlOwner;
  handoff_reason?: HandoffReason;
  takeover_available?: boolean;
  takeover_unavailable_reason?: TakeoverUnavailableReason;
}

export interface ViewerControlUnavailable {
  status: "unavailable";
  failure_class: ViewerControlFailureClass;
  message: string;
  retryable: boolean;
}

export interface CoreRuntimeFacts {
  schema_version: typeof HARBOR_CORE_RUNTIME_FACTS_SCHEMA;
  runtime_session_ref: string;
  identity_environment_ref?: string;
  execution_identity_ref?: string;
  profile_ref: string;
  provider_ref: string;
  provider_mode: string;
  lifecycle_state: string;
  availability: ViewerControlSessionFacts["availability"];
  viewer: Pick<ViewerRefFacts, "viewer_ref" | "availability" | "access_mode" | "expires_at">;
  control: Pick<ControlOwnerFacts, "owner" | "handoff_reason" | "takeover" | "updated_at">;
  current_error: RuntimeErrorFact | null;
  fact_refs: {
    session: string;
    viewer: string;
  };
  unavailable: null;
}

export interface AppRuntimeStatusFixture {
  schema_version: typeof HARBOR_APP_RUNTIME_STATUS_FIXTURE_SCHEMA;
  runtime_session_ref: string;
  browser_status: AppBrowserStatus;
  viewer_status: {
    viewer_ref: string;
    display_state: ViewerAvailability;
    access_mode: ViewerAccessMode;
    expires_at: string;
  };
  control_status: Pick<ControlOwnerFacts, "owner" | "handoff_reason" | "takeover" | "updated_at">;
  updated_at: string;
  unavailable: null;
}

export class ViewerControlStore {
  private readonly records = new Map<string, ViewerControlFacts>();

  create(session: ViewerControlSessionFacts, created_at: string): ViewerControlFacts {
    const record: ViewerControlFacts = {
      schema_version: HARBOR_VIEWER_CONTROL_FACTS_SCHEMA,
      runtime_session_ref: session.runtime_session_ref,
      profile_ref: session.profile_ref,
      provider_ref: session.provider_ref,
      viewer: {
        viewer_ref: opaqueRef("viewer"),
        viewer_url: null,
        availability: session.viewer_entry?.availability ?? "unsupported",
        access_mode: session.viewer_entry?.access_mode ?? "none",
        transport: session.viewer_entry?.transport ?? "not_applicable",
        input_capabilities: session.viewer_entry?.input_capabilities ?? [],
        access_boundary: "harbor_ref_only",
        created_at,
        expires_at: expiresAfter(created_at, 60 * 60 * 1000),
        unavailable_reason: session.viewer_entry?.unavailable_reason ?? defaultViewerUnavailableReason(session.viewer_entry?.availability)
      },
      control: {
        owner: session.lifecycle_state === "failed" ? "none" : session.control_owner ?? "system",
        previous_owner: null,
        handoff_reason: null,
        takeover: {
          available: false,
          unavailable_reason: "viewer_unavailable"
        },
        updated_at: created_at
      },
      privacy_boundary: {
        access_policy: "harbor_mediated_ref",
        raw_cdp_endpoint: "not_exposed",
        raw_vnc_endpoint: "not_exposed",
        browser_private_state: "not_exposed",
        auth_private_state: "not_exposed",
        full_profile_storage: "not_exposed"
      },
      unavailable: null
    };
    this.records.set(session.runtime_session_ref, record);
    return clone(record);
  }

  get(runtime_session_ref: string): ViewerControlFacts | ViewerControlUnavailable {
    const record = this.records.get(runtime_session_ref);
    return record ? clone(record) : unavailableControl("session_missing", "Runtime Session is missing.", true);
  }

  recordHandoff(runtime_session_ref: string, input: RecordHandoffInput): ViewerControlFacts | ViewerControlUnavailable {
    const record = this.records.get(runtime_session_ref);
    if (!record) return unavailableControl("control_owner_unknown", "Control owner cannot be updated for a missing Runtime Session.", true);

    const now = new Date().toISOString();
    const previous_owner = record.control.owner;
    record.control = {
      owner: input.control_owner,
      previous_owner,
      handoff_reason: input.handoff_reason ?? record.control.handoff_reason,
      takeover: {
        available: input.takeover_available ?? false,
        unavailable_reason: input.takeover_available ? undefined : input.takeover_unavailable_reason ?? defaultTakeoverReason(input.control_owner)
      },
      updated_at: now
    };
    return clone(record);
  }

  markClosed(runtime_session_ref: string, closed_at: string): void {
    const record = this.records.get(runtime_session_ref);
    if (!record) return;
    record.viewer.availability = "expired";
    record.viewer.access_mode = "none";
    record.viewer.unavailable_reason = "session_unavailable";
    record.control = {
      owner: "none",
      previous_owner: record.control.owner,
      handoff_reason: record.control.handoff_reason,
      takeover: {
        available: false,
        unavailable_reason: "session_unavailable"
      },
      updated_at: closed_at
    };
  }
}

export function coreRuntimeFacts(
  session: ViewerControlSessionFacts,
  viewerControl: ViewerControlFacts
): CoreRuntimeFacts {
  return {
    schema_version: HARBOR_CORE_RUNTIME_FACTS_SCHEMA,
    runtime_session_ref: session.runtime_session_ref,
    ...(session.identity_environment_ref === undefined ? {} : { identity_environment_ref: session.identity_environment_ref }),
    ...(session.execution_identity_ref === undefined ? {} : { execution_identity_ref: session.execution_identity_ref }),
    profile_ref: session.profile_ref,
    provider_ref: session.provider_ref,
    provider_mode: session.provider_mode,
    lifecycle_state: session.lifecycle_state,
    availability: clone(session.availability),
    viewer: {
      viewer_ref: viewerControl.viewer.viewer_ref,
      availability: viewerControl.viewer.availability,
      access_mode: viewerControl.viewer.access_mode,
      expires_at: viewerControl.viewer.expires_at
    },
    control: {
      owner: viewerControl.control.owner,
      handoff_reason: viewerControl.control.handoff_reason,
      takeover: clone(viewerControl.control.takeover),
      updated_at: viewerControl.control.updated_at
    },
    current_error: publicRuntimeError(session.current_error),
    fact_refs: {
      session: session.runtime_session_ref,
      viewer: viewerControl.viewer.viewer_ref
    },
    unavailable: null
  };
}

export function appRuntimeStatusFixture(
  session: ViewerControlSessionFacts,
  viewerControl: ViewerControlFacts
): AppRuntimeStatusFixture {
  const updated_at = viewerControl.control.updated_at;
  return {
    schema_version: HARBOR_APP_RUNTIME_STATUS_FIXTURE_SCHEMA,
    runtime_session_ref: session.runtime_session_ref,
    browser_status: browserStatus(session.lifecycle_state),
    viewer_status: {
      viewer_ref: viewerControl.viewer.viewer_ref,
      display_state: viewerControl.viewer.availability,
      access_mode: viewerControl.viewer.access_mode,
      expires_at: viewerControl.viewer.expires_at
    },
    control_status: {
      owner: viewerControl.control.owner,
      handoff_reason: viewerControl.control.handoff_reason,
      takeover: clone(viewerControl.control.takeover),
      updated_at
    },
    updated_at,
    unavailable: null
  };
}

function browserStatus(lifecycle_state: string): AppBrowserStatus {
  if (lifecycle_state === "active" || lifecycle_state === "idle" || lifecycle_state === "locked") return "ready";
  if (lifecycle_state === "closed" || lifecycle_state === "expired") return "closed";
  return "unavailable";
}

function defaultTakeoverReason(owner: ControlOwner): TakeoverUnavailableReason {
  if (owner === "user") return "already_user_controlled";
  if (owner === "none") return "session_unavailable";
  return "viewer_unavailable";
}

function defaultViewerUnavailableReason(availability: ViewerAvailability | undefined): TakeoverUnavailableReason | undefined {
  if (availability === "available") return undefined;
  return availability === "permission_denied" ? "permission_denied" : "unsupported";
}

function expiresAfter(created_at: string, ttlMs: number): string {
  return new Date(Date.parse(created_at) + ttlMs).toISOString();
}

function unavailableControl(
  failure_class: ViewerControlFailureClass,
  message: string,
  retryable: boolean
): ViewerControlUnavailable {
  return { status: "unavailable", failure_class, message, retryable };
}

function publicRuntimeError(current_error: RuntimeErrorFact | null): RuntimeErrorFact | null {
  if (!current_error) return null;
  return {
    code: current_error.code,
    message: "Runtime Session is unavailable.",
    retryable: current_error.retryable
  };
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
