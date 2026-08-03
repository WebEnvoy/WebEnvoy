import type { LocalIdentityEnvironmentFacts, LocalIdentityEnvironmentInput } from "./identity-environment.js";
import type { ControlOwner, InputCapability, TakeoverUnavailableReason, ViewerAccessMode, ViewerAvailability, ViewerTransport } from "./viewer-control.js";

export const HARBOR_RUNTIME_FACTS_SCHEMA = "harbor-runtime-facts/v0";
export const HARBOR_VALIDATION_RUNTIME_FACTS_SCHEMA = "harbor-validation-runtime-facts/v0";

export type AvailabilityState = "available" | "unavailable" | "policy_denied" | "unsupported";
export type FactSource = "configured" | "observed" | "provider_claim" | "validation_evidence";
export type LifecycleState = "starting" | "active" | "idle" | "locked" | "disconnected" | "expired" | "failed" | "closed";
export type ProviderMode = "local_dedicated_profile";
export type RuntimeErrorCode =
  | "provider_unavailable"
  | "identity_environment_unavailable"
  | "launch_failed"
  | "url_unreachable"
  | "session_locked"
  | "session_cleanup_failed"
  | "cdp_unavailable"
  | "profile_locked"
  | "session_lost"
  | "capture_denied"
  | "unsupported";

export interface RuntimeFact {
  key: string;
  source: FactSource;
  value: string;
  evidence_ref?: string;
}

export interface RuntimeErrorFact {
  code: RuntimeErrorCode;
  message: string;
  retryable: boolean;
}

export type RuntimePageStatus = "ready" | "unavailable" | "unknown";
export type RuntimeControlLockState = "held" | "released" | "closed";

export interface LocalProviderScreenshotFacts {
  screenshot_ref: string;
  mime_type: "image/png";
  byte_length: number;
  sha256: string;
  captured_at: string;
  facts: RuntimeFact[];
}

export interface RuntimeViewerEntry {
  availability: ViewerAvailability;
  access_mode: ViewerAccessMode;
  transport: ViewerTransport;
  input_capabilities: InputCapability[];
  unavailable_reason?: TakeoverUnavailableReason;
}

export interface RuntimePageFacts {
  requested_url: string;
  current_url: string | null;
  title: string | null;
  status: RuntimePageStatus;
  error_reason: RuntimeErrorFact | null;
  observed_at: string;
}

export interface RuntimeControlLockFacts {
  owner: ControlOwner;
  state: RuntimeControlLockState;
  holder_ref: string | null;
  updated_at: string;
  conflict_error: RuntimeErrorFact | null;
}

export interface RuntimeSessionUnavailable {
  status: "unavailable";
  failure_class: "identity_environment_unavailable" | "session_locked" | "session_cleanup_failed" | "session_missing" | "url_unreachable";
  message: string;
  retryable: boolean;
  current_error: RuntimeErrorFact;
}

export interface RuntimeSessionFacts {
  schema_version: typeof HARBOR_RUNTIME_FACTS_SCHEMA;
  runtime_session_ref: string;
  identity_environment_ref?: string;
  execution_identity_ref?: string;
  profile_ref: string;
  provider_ref: string;
  provider_mode: ProviderMode;
  lifecycle_state: LifecycleState;
  created_at: string;
  last_seen_at: string;
  closed_at?: string;
  availability: {
    cdp: AvailabilityState;
    viewer: AvailabilityState;
    snapshot: AvailabilityState;
    evidence: AvailabilityState;
  };
  cdp_ref?: string;
  viewer_ref?: string;
  viewer_entry?: RuntimeViewerEntry;
  current_page: RuntimePageFacts;
  control_owner: ControlOwner;
  control_lock: RuntimeControlLockFacts;
  current_error: RuntimeErrorFact | null;
  facts: RuntimeFact[];
}

export function isRuntimeSessionReadable(
  session: Pick<RuntimeSessionFacts, "lifecycle_state"> &
    Partial<Pick<RuntimeSessionFacts, "control_owner" | "control_lock">>
): boolean {
  return session.lifecycle_state === "active" ||
    session.lifecycle_state === "idle" ||
    (
      session.lifecycle_state === "locked" &&
      session.control_owner === "core_task" &&
      session.control_lock?.owner === "core_task" &&
      session.control_lock.state === "held"
    );
}

export interface ValidationRuntimeFacts {
  schema_version: typeof HARBOR_VALIDATION_RUNTIME_FACTS_SCHEMA;
  runtime_session_ref: string;
  provider_ref: string;
  profile_ref: string;
  validation_refs: string[];
  runtime_ready: boolean;
  blocking_reasons: RuntimeErrorFact[];
  availability: RuntimeSessionFacts["availability"];
  unavailable: null;
}

export interface CreateRuntimeSessionInput {
  browser_path?: string;
  headless?: boolean;
  timeout_ms?: number;
  url?: string;
  identity_environment_ref?: string;
  execution_identity_ref?: string;
  profile_ref?: string;
  profile_storage_ref?: string;
  provider_ref?: string;
  control_owner?: ControlOwner;
  holder_ref?: string;
  managed_identity_environment?: LocalIdentityEnvironmentFacts;
}

export interface OpenIdentityEnvironmentSessionInput extends CreateRuntimeSessionInput {
  identity_environment: LocalIdentityEnvironmentInput | LocalIdentityEnvironmentFacts;
  url: string;
  reuse_existing?: boolean;
}

export interface RuntimeSessionControlInput {
  control_owner?: ControlOwner;
  holder_ref?: string;
}

export interface LocalProviderLaunchInput {
  browser_path: string;
  headless: boolean;
  timeout_ms: number;
  url: string;
  profile_ref: string;
  profile_storage_ref?: string;
  provider_ref: string;
  identity_environment?: LocalIdentityEnvironmentFacts;
  resolve_proxy?: (proxy_ref: string) => string | null;
}

export interface LocalProviderPageFacts {
  current_url: string | null;
  title: string | null;
  status: RuntimePageStatus;
  error?: RuntimeErrorFact;
  facts: RuntimeFact[];
}

export type AllowlistedReadOperationSite = "xiaohongshu" | "boss";
export type AllowlistedReadOperationId = "xhs_search_notes" | "boss_job_search" | "xhs_read_note_detail" | "boss_read_job_detail";

export interface LocalProviderReadProbeInput {
  site_id: AllowlistedReadOperationSite;
  operation_id: AllowlistedReadOperationId;
  query?: string;
  city_code?: string;
  limit?: number;
  detail_ref?: string;
  target_url: string;
  expected_origin: string;
}

export type LocalProviderSiteResourceReadinessFactKey =
  | "page.vue_app.ready"
  | "page.pinia_store.ready"
  | "page.boss_spa.ready";

export type LocalProviderSiteResourceProbeInput =
  | {
      site_id: "boss";
      task_kind: "job_search" | "boss_job_search";
      signal?: AbortSignal;
    }
  | {
      site_id: "xiaohongshu";
      task_kind: "search_notes" | "xhs_search_notes" | "read_note_detail" | "xhs_read_note_detail";
      signal?: AbortSignal;
    };

export type LocalProviderSiteResourceProbeResult =
  | {
      status: "available";
      observed_at: string;
      evidence_ref: string;
      verified_fact_keys: readonly LocalProviderSiteResourceReadinessFactKey[];
    }
  | {
      status: "blocked" | "unavailable" | "unknown";
      failure_class: "not_logged_in" | "safety_challenge" | "page_not_ready" | "provider_probe_unavailable";
      message: string;
      verified_fact_keys: readonly LocalProviderSiteResourceReadinessFactKey[];
      evidence_ref?: string;
    };

export interface LocalProviderReadProbePublicSummary {
  schema_version: "harbor-read-operation-public-summary/v0" | "harbor-read-operation-public-summary/v1";
  operation_id: AllowlistedReadOperationId;
  result_kind: "xiaohongshu_search_notes_surface" | "boss_job_search_surface" | "xiaohongshu_note_detail_surface" | "boss_job_detail_surface";
  surface: "search_result" | "web_geek_jobs" | "note_detail" | "job_detail";
  result_state: "operation_read_response_observed";
  response_status: number;
  query?: string;
  city_code?: string;
  business_code?: number;
  job_count?: number;
  result_count?: number;
  detail_refs?: readonly string[];
  items?: readonly XiaohongshuSearchPublicItem[];
  normalized?: LocalProviderDetailPublicSummary;
  source_signals: readonly string[];
}

export interface XiaohongshuSearchPublicFields {
  title: string;
  author_display_name?: string;
  interaction_metrics?: {
    likes?: string;
    comments?: string;
    collects?: string;
  };
}

export interface XiaohongshuSearchPublicItem extends XiaohongshuSearchPublicFields {
  detail_ref: string;
}

export interface XiaohongshuNoteDetailPublicSummary {
  kind: "xiaohongshu_note_detail";
  canonical_url: string;
  note_id: string;
  title: string;
  summary: string;
  body_summary: string;
  author: { display_name: string; author_id: string; profile_url: string };
  interaction_metrics: { likes: string; comments: string; collects: string; shares: string };
  source_citation: {
    kind: "xhs_note_detail_ref";
    note_id: string;
    url: string;
    field_sources: readonly string[];
  };
  source_status: "located" | "partially_located";
}

export interface BossJobDetailPublicSummary {
  kind: "boss_job_detail";
  canonical_url: string;
  detail_ref: string;
  title: string;
  summary: string;
  job: {
    title: string;
    description: string;
    status: string;
    salary?: string;
    location?: string;
  };
  company: { name: string };
  recruiter: { name: string; title: string };
  source_citation: {
    kind: "boss_job_detail_ref";
    detail_ref: string;
    url: string;
    field_sources: readonly string[];
  };
  source_status: "located" | "partially_located";
}

export type LocalProviderDetailPublicSummary = XiaohongshuNoteDetailPublicSummary | BossJobDetailPublicSummary;

export interface LocalProviderReadProbeDetailTarget {
  canonical_url: string;
}

export interface LocalProviderReadProbeRef {
  kind: string;
  ref: string;
}

export type LocalProviderReadProbeResult =
  | {
      status: "completed";
      observed_at: string;
      observed_origin: string;
      page: LocalProviderPageFacts;
      source_refs: LocalProviderReadProbeRef[];
      evidence_ref_kinds: LocalProviderReadProbeRef[];
      public_summary_source_ref: string;
      public_summary: LocalProviderReadProbePublicSummary;
      detail_targets?: LocalProviderReadProbeDetailTarget[];
      search_items?: XiaohongshuSearchPublicFields[];
    }
  | {
      status: "unavailable";
      failure_class: "origin_drift" | "not_logged_in" | "safety_challenge" | "page_not_ready" | "network_resource_unavailable" | "evidence_refs_missing" | "fixture_runtime" | "provider_probe_unavailable" | "permission_denied" | "city_unresolved" | "empty_result" | "field_missing" | "site_changed";
      message: string;
      retryable: boolean;
      page?: LocalProviderPageFacts;
    };

export type LocalProviderLaunchResult =
  | {
      status: "ready";
      cdp_ref: string;
      viewer_entry: RuntimeViewerEntry;
      page: LocalProviderPageFacts;
      facts: RuntimeFact[];
      execution_surface?: "local_provider" | "fixture";
      openUrl: (url: string) => Promise<LocalProviderPageFacts>;
      probeSiteResource?: (input: LocalProviderSiteResourceProbeInput) => Promise<LocalProviderSiteResourceProbeResult>;
      probeReadOperation?: (input: LocalProviderReadProbeInput) => Promise<LocalProviderReadProbeResult>;
      captureScreenshot: () => Promise<LocalProviderScreenshotFacts | RuntimeErrorFact>;
      close: () => Promise<void>;
    }
  | { status: "unavailable"; error: RuntimeErrorFact; facts: RuntimeFact[] };

export type LocalProviderLauncher = (input: LocalProviderLaunchInput) => Promise<LocalProviderLaunchResult>;
