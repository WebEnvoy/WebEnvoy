import type { LocalIdentityEnvironmentFacts, LocalIdentityEnvironmentInput } from "./identity-environment.js";
import type { BrowserProviderId } from "./provider-management.js";
import type { ControlOwner, InputCapability, TakeoverUnavailableReason, ViewerAccessMode, ViewerAvailability, ViewerTransport } from "./viewer-control.js";
import type { RuntimeDiagnosticsInput, RuntimeDiagnosticsResponse } from "./runtime-diagnostics.js";

export const HARBOR_RUNTIME_FACTS_SCHEMA = "harbor-runtime-facts/v0";
export const HARBOR_VALIDATION_RUNTIME_FACTS_SCHEMA = "harbor-validation-runtime-facts/v0";

export type AvailabilityState = "available" | "unavailable" | "policy_denied" | "unsupported";
export type FactSource = "configured" | "observed" | "provider_claim" | "validation_evidence";
export type LifecycleState = "starting" | "active" | "idle" | "locked" | "disconnected" | "expired" | "failed" | "closed";
export type ProviderMode = "local_dedicated_profile";
/** The transport owned by a local provider driver. */
export type LocalProviderDriverKind = "chromium_cdp" | "firefox_juggler";
export type RuntimeErrorCode =
  | "provider_unavailable"
  | "identity_environment_unavailable"
  | "launch_failed"
  | "url_unreachable"
  | "session_locked"
  | "session_cleanup_failed"
  | "cdp_unavailable"
  | "driver_unavailable"
  | "profile_locked"
  | "recovery_operation_unfinished"
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
    /** Generic driver readiness. `cdp` remains for Chromium compatibility. */
    driver?: AvailabilityState;
    cdp: AvailabilityState;
    viewer: AvailabilityState;
    snapshot: AvailabilityState;
    evidence: AvailabilityState;
  };
  driver_ref?: string;
  driver_kind?: LocalProviderDriverKind;
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

export function isRuntimeDriverAvailable(
  session: Pick<RuntimeSessionFacts, "availability">
): boolean {
  return (session.availability.driver ?? session.availability.cdp) === "available";
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
  operation_scope?: "profile_management";
  browser_path?: string;
  headless?: boolean;
  timeout_ms?: number;
  url?: string;
  identity_environment_ref?: string;
  execution_identity_ref?: string;
  profile_ref?: string;
  profile_storage_ref?: string;
  provider_ref?: string;
  provider_id?: BrowserProviderId;
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
  operation_scope?: "profile_management";
  browser_path: string;
  headless: boolean;
  timeout_ms: number;
  url: string;
  profile_ref: string;
  profile_storage_ref?: string;
  provider_ref: string;
  provider_id?: BrowserProviderId;
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

export interface LocalProviderWritePrecheckProbeInput {
  target_url: string;
  expected_origin: "https://creator.xiaohongshu.com";
  target_ref: string;
  /** Optional Core expectation used only for read-only public observation matching. */
  expected?: XhsPublicObservationExpected;
  /** Confirmation observations do not need a screenshot body; legacy probes may opt in. */
  capture_screenshot?: boolean;
  /** Controlled path hint; no selector/script is accepted at this boundary. */
  composition_path?: XhsWritePrecheckCompositionPath;
  /** #405 user-selected path; Harbor may select only this exact visible control. */
  requested_path?: XhsPathPrepareRequestedPath;
}

/** Public, bounded path ids owned by the Lode composition catalog. */
export type XhsWritePrecheckCompositionPath =
  | "image_text_upload"
  | "image_text_generate"
  | "video"
  | "long_article"
  | "podcast";

export type XhsPathPrepareRequestedPath = "image_text_upload" | "image_text_generate";
export type XhsPathPrepareObservedPath = "observed" | "unknown" | "mismatch";
export type XhsPathPrepareCompositionState = "initialized" | "not_initialized" | "unknown";

/** Exact Lode image-text actions admitted by the current consumer. */
export type XhsMediaActionId =
  | "xhs_publish_note_image_text_media.image_upload"
  | "xhs_publish_note_image_text_media.text_to_image_generate"
  | "xhs_publish_note_image_text_fields.compose"
  | "xhs_publish_note_image_text_commit.save_draft"
  | "xhs_publish_note_image_text_commit.publish"
  | "xhs_publish_note_image_text_commit.cleanup";
export type XhsMediaActionPath = "image_text_upload" | "image_text_generate";
export type XhsMediaEffectKind = "upload" | "generate" | "modify" | "save_draft" | "publish" | "cleanup";
export type XhsMediaOperationStatus = "accepted" | "running" | "terminal" | "unknown_outcome";

export interface LocalProviderMediaAuthorizationBinding {
  /** Core's existing authorization decision reference; Harbor does not persist or resolve it. */
  decision_ref: string;
  action_id: XhsMediaActionId;
  target_ref: string;
  /** Core's existing TaskTurnRecord idempotency key; Harbor does not persist it. */
  idempotency_key: string;
}

export interface LocalProviderMediaActionInput {
  target_url: string;
  expected_origin: "https://creator.xiaohongshu.com";
  target_ref: string;
  action_id: XhsMediaActionId;
  requested_path: XhsMediaActionPath;
  refs: readonly string[];
  summary: string;
  marker?: string;
  visibility?: "not_applicable" | "only_me" | "public";
  holder_ref?: string;
  no_submit_guard: "active";
  /** Transient Core binding checked before the first external effect. */
  authorization_binding: LocalProviderMediaAuthorizationBinding;
}

export type LocalProviderMediaActionResult =
  | ({
      status: "completed";
      observed_at: string;
      observed_url: string;
      page: LocalProviderPageFacts;
      action_id: "xhs_publish_note_image_text_media.image_upload" | "xhs_publish_note_image_text_media.text_to_image_generate";
      requested_path: XhsMediaActionPath;
      effect_kind: "upload" | "generate";
      effect_status: "requested" | "observed" | "unknown" | "failed";
      operation_status: XhsMediaOperationStatus;
      operation_ref: string;
      terminal_state?: "success" | "failure";
      media_readback: {
        status: "observed" | "unknown" | "mismatch" | "not_applicable";
        media_count: number | null;
        order_status: "observed" | "unknown" | "not_applicable";
        ordered_item_refs?: readonly string[];
        generation_result_ref: string | null;
      };
      page_readback: {
        status: "observed" | "unknown" | "mismatch";
        page_state_ref: string;
        route_state: "observed" | "unknown" | "mismatch";
      };
      source_refs: LocalProviderReadProbeRef[];
      evidence_ref_kinds: LocalProviderReadProbeRef[];
      submitted: false;
    })
  | ({
      status: "completed";
      observed_at: string;
      observed_url: string;
      page: LocalProviderPageFacts;
      action_id: "xhs_publish_note_image_text_commit.save_draft" | "xhs_publish_note_image_text_commit.publish" | "xhs_publish_note_image_text_commit.cleanup";
      requested_path: "image_text_upload";
      effect_kind: "save_draft" | "publish" | "cleanup";
      effect_status: "observed" | "unknown" | "failed";
      operation_status: XhsMediaOperationStatus;
      operation_ref: string;
      terminal_state?: "success" | "failure";
      marker_state: "matched" | "mismatched" | "unknown";
      visibility_state: "not_applicable" | "only_me" | "public" | "unknown";
      content_readback: {
        state: "draft_saved" | "published" | "deleted" | "not_observed" | "unknown";
        management_list_state: "matched" | "not_found" | "unknown" | "not_run";
        detail_state: "matched" | "mismatched" | "unknown" | "not_run";
        fields_state: "matched" | "mismatched" | "unknown";
        media_state: "matched" | "mismatched" | "unknown";
        marker_state: "matched" | "mismatched" | "unknown";
        content_ref: string | null;
        canonical_url: string | null;
      };
      page_readback: {
        status: "observed" | "unknown" | "mismatch";
        page_state_ref: string;
        route_state: "observed" | "unknown" | "mismatch";
      };
      source_refs: LocalProviderReadProbeRef[];
      evidence_ref_kinds: LocalProviderReadProbeRef[];
      submitted: true;
    })
  | ({
      status: "completed";
      observed_at: string;
      observed_url: string;
      page: LocalProviderPageFacts;
      action_id: "xhs_publish_note_image_text_fields.compose";
      requested_path: "image_text_upload";
      effect_kind: "modify";
      effect_status: "requested" | "observed" | "unknown" | "failed";
      operation_status: XhsMediaOperationStatus;
      operation_ref: string;
      terminal_state?: "success" | "failure";
      field_readback: {
        status: "observed" | "unknown" | "mismatch";
        title: { status: "observed" | "unknown" | "mismatch"; value_state: "matched" | "mismatch" | "unknown" };
        body: { status: "observed" | "unknown" | "mismatch"; value_state: "matched" | "mismatch" | "unknown" };
        validation_status: "passed" | "failed" | "unknown";
      };
      page_readback: {
        status: "observed" | "unknown" | "mismatch";
        page_state_ref: string;
        route_state: "observed" | "unknown" | "mismatch";
      };
      source_refs: LocalProviderReadProbeRef[];
      evidence_ref_kinds: LocalProviderReadProbeRef[];
      submitted: false;
    })
  | {
      status: "unavailable";
      failure_class:
        | "invalid_contract"
        | "login_required"
        | "permission_insufficient"
        | "page_changed"
        | "safety_challenge"
        | "resource_unavailable"
        | "media_ref_unavailable"
        | "generation_unavailable"
        | "field_unavailable"
        | "validation_failed"
        | "commit_control_unavailable"
        | "operation_result_unknown"
        | "post_check_failed"
        | "reconciliation_unknown"
        | "session_missing"
        | "session_not_ready"
        | "session_user_controlled"
        | "fixture_runtime"
        | "provider_probe_unavailable";
      message: string;
      retryable: boolean;
      operation_ref?: string;
      page?: LocalProviderPageFacts;
      diagnostics?: {
        failure_stage:
          | "media_ref_resolution"
          | "file_input_missing"
          | "file_input_ambiguous"
          | "file_input_object_resolution"
          | "set_file_input_files";
        image_input_candidate_count?: number;
        image_path_candidate_count?: number;
        set_file_input_files: "not_called" | "unknown";
      };
      submitted: boolean;
    };

export interface XhsPathPrepareBusinessState {
  route_state: XhsPathPrepareObservedPath;
  control_owner_state: XhsPathPrepareObservedPath;
  observed_path: XhsPathPrepareObservedPath;
  composition_state: XhsPathPrepareCompositionState;
  submitted: false;
}

export interface XhsPathPrepareNormalizedState {
  requested_path: XhsPathPrepareRequestedPath;
  observed_path: XhsPathPrepareObservedPath;
  composition_state: XhsPathPrepareCompositionState;
  business_state_before: XhsPathPrepareBusinessState;
  business_state_after: XhsPathPrepareBusinessState;
  interaction: {
    allowed_action: "exact_visible_path_control_selection";
    requested_control: "upload_image" | "generate_image";
    selection_status: "selected" | "not_performed" | "blocked" | "unknown";
    readback_status: "read" | "not_read" | "unknown";
  };
  composition_state_proof: {
    basis: "business_state_readback" | "unknown";
    path_entry_alone_proves_initialized: false;
  };
  submitted: false;
  prohibited_actions_observed: {
    file_chooser: false;
    file_select: false;
    upload: false;
    generate: false;
    field_fill: false;
    save_draft: false;
    publish: false;
    submit: false;
    retry: false;
    bypass: false;
  };
  no_submit_guard_status: "active";
}

export type XhsWritePrecheckCompositionState =
  | "composition_initialized"
  | "composition_not_initialized"
  | "composition_unknown";

export type XhsWritePrecheckObservationStatus = "observed" | "unobserved" | "unknown";
export type XhsWritePrecheckAvailability = "available" | "unavailable" | "unknown";

export type XhsPublicObservationExpected = {
  account_ref?: string;
  business_target_ref?: string;
  title?: string;
  body?: string;
  media_refs?: readonly string[];
};

export type XhsPublicObservationExpectedMatch = "matched" | "mismatched" | "unknown";
export type XhsPublicObservationPendingIssueCode =
  | "account_unknown"
  | "account_mismatch"
  | "business_target_unknown"
  | "business_target_mismatch"
  | "image_count_unknown"
  | "image_order_unknown"
  | "image_order_mismatch"
  | "title_unknown"
  | "title_mismatch"
  | "body_unknown"
  | "body_mismatch"
  | "page_fingerprint_unknown"
  | "page_changed"
  | "page_diff_unknown";

export interface XhsPublicObservationLabelRef {
  status: "observed" | "unknown";
  label: string | null;
  ref: string | null;
  expected_match: XhsPublicObservationExpectedMatch;
}

export interface XhsPublicObservationFieldSummary {
  status: "observed" | "unknown" | "mismatch";
  summary: {
    state: "empty" | "present" | "unknown";
    length: number | null;
    fingerprint: string | null;
  };
  expected_match: XhsPublicObservationExpectedMatch;
}

export interface XhsPublicObservation {
  schema_version: "harbor-xhs-public-observation/v0";
  status: "observed" | "unknown";
  account: XhsPublicObservationLabelRef;
  business_target: XhsPublicObservationLabelRef;
  media: {
    image_count: number | null;
    order_status: "observed" | "unknown";
    ordered_item_refs: readonly string[];
    expected_match: XhsPublicObservationExpectedMatch;
  };
  fields: {
    title: XhsPublicObservationFieldSummary;
    body: XhsPublicObservationFieldSummary;
  };
  page: {
    fingerprint: string | null;
    diff: "unchanged" | "changed" | "unknown";
  };
  pending_issue_codes: readonly XhsPublicObservationPendingIssueCode[];
  submitted: false;
}

/**
 * Refs-safe stage for a validate-only path-preparation failure.  This stays
 * deliberately small so the next live attempt has one bounded root cause to
 * inspect without exposing browser material.
 */
export type XhsPathPrepareFailureStage =
  | "session_precheck"
  | "provider_probe_initial"
  | "provider_selection"
  | "provider_readback_freshness";

export interface XhsWritePrecheckFieldState {
  availability: XhsWritePrecheckAvailability;
  observation: "observed" | "not_observed" | "unknown";
  required?: XhsWritePrecheckObservationStatus;
  editable?: XhsWritePrecheckObservationStatus;
  value_state?: "empty" | "present" | "unknown";
}

export interface XhsWritePrecheckMediaState {
  availability: XhsWritePrecheckAvailability;
  observation: "observed" | "not_observed" | "unknown";
  controls?: Record<string, XhsWritePrecheckFieldState>;
}

export type LocalProviderWritePrecheckProbeResult =
  | {
      status: "completed";
      observed_at: string;
      observed_url: string;
      page: LocalProviderPageFacts;
      source_refs: LocalProviderReadProbeRef[];
      evidence_ref_kinds: LocalProviderReadProbeRef[];
      classification: "partial_result";
      precheck_scope: "entrypoint_only" | "composition_observation";
      composition_path: XhsWritePrecheckCompositionPath;
      composition_state: XhsWritePrecheckCompositionState;
      entrypoint_observations: {
        route_loaded: boolean;
        publish_vue_container_visible: boolean;
        upload_image_tab_active: boolean;
        upload_image_entry_visible: boolean;
        text_image_entry_visible: boolean;
        path_observed?: XhsWritePrecheckObservationStatus;
        path_entry_visible?: XhsWritePrecheckObservationStatus;
      };
      field_states: Record<string, XhsWritePrecheckFieldState>;
      media_state: XhsWritePrecheckMediaState;
      validation_state: XhsWritePrecheckFieldState;
      save_draft_control: XhsWritePrecheckFieldState;
      publish_control: XhsWritePrecheckFieldState;
      prohibited_actions_observed: { upload: false; generate: false; save: false; publish: false };
      target_ref: string;
      public_observation: XhsPublicObservation;
      path_prepare?: XhsPathPrepareNormalizedState;
    }
  | {
      status: "unavailable";
      failure_class:
        | "login_required"
        | "page_changed"
        | "target_not_writable"
        | "safety_challenge"
        | "evidence_unavailable"
        | "fixture_runtime"
        | "provider_probe_unavailable";
      message: string;
      retryable: boolean;
      failure_stage?: XhsPathPrepareFailureStage;
      page?: LocalProviderPageFacts;
    };

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
      task_kind: "authentication_recovery" | "search_notes" | "xhs_search_notes" | "read_note_detail" | "xhs_read_note_detail";
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
      /** Opaque generic driver handle. CDP providers may omit this for compatibility. */
      driver_ref?: string;
      driver_kind?: LocalProviderDriverKind;
      /** Opaque CDP handle, present only for Chromium/CDP drivers. */
      cdp_ref?: string;
      viewer_entry: RuntimeViewerEntry;
      page: LocalProviderPageFacts;
      facts: RuntimeFact[];
      execution_surface?: "local_provider" | "fixture";
      openUrl: (url: string, operation_scope?: "profile_management") => Promise<LocalProviderPageFacts>;
      clearPublicPageGuard?: () => Promise<void>;
      publicPage?: import("./managed-observation.js").ManagedPublicPageOperation;
      interaction?: import("./managed-interaction.js").ManagedInteractionOperation;
      observePage?: () => Promise<import("./managed-observation.js").ManagedProviderObservation>;
      readDiagnostics?: (input: RuntimeDiagnosticsInput) => Promise<RuntimeDiagnosticsResponse>;
      readEnvironment?: import("./profile-environment.js").EnvironmentProbe;
      probeSiteResource?: (input: LocalProviderSiteResourceProbeInput) => Promise<LocalProviderSiteResourceProbeResult>;
      probeReadOperation?: (input: LocalProviderReadProbeInput) => Promise<LocalProviderReadProbeResult>;
      probeWritePrecheck?: (input: LocalProviderWritePrecheckProbeInput) => Promise<LocalProviderWritePrecheckProbeResult>;
      executeMediaAction?: (input: LocalProviderMediaActionInput) => Promise<LocalProviderMediaActionResult>;
      captureScreenshot: () => Promise<LocalProviderScreenshotFacts | RuntimeErrorFact>;
      close: () => Promise<void>;
    }
  | { status: "unavailable"; error: RuntimeErrorFact; facts: RuntimeFact[] };

export type LocalProviderLauncher = (input: LocalProviderLaunchInput) => Promise<LocalProviderLaunchResult>;
