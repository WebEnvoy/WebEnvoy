import type { SnapshotCaptureResult } from "./page-scene.js";
import {
  isRuntimeSessionReadable,
  type LocalProviderSiteResourceProbeResult,
  type RuntimeSessionFacts
} from "./runtime-session-types.js";

/** @deprecated Compatibility-only site resource schema; Core owns new admission facts. */
export const HARBOR_SITE_RESOURCE_FACTS_SCHEMA = "harbor-site-resource-facts/v0";

export type SiteRuntimeId = "xiaohongshu" | "boss";
export type SiteResourceFactState = "available" | "unavailable" | "unknown" | "blocked" | "unsupported";
export type SiteResourceFactSeverity = "info" | "warning" | "blocking";
export type SiteResourceFactSource = "configured" | "observed" | "derived" | "validation_evidence";

export interface SiteResourceFactsInput {
  site_id?: string;
  task_kind?: string;
}

export interface SiteResourceFact {
  key: string;
  state: SiteResourceFactState;
  source: SiteResourceFactSource;
  severity: SiteResourceFactSeverity;
  message: string;
  evidence_ref?: string;
}

export interface SiteResourceFacts {
  schema_version: typeof HARBOR_SITE_RESOURCE_FACTS_SCHEMA;
  runtime_session_ref: string;
  provider_ref: string;
  profile_ref: string;
  site_id: SiteRuntimeId;
  task_kind: string;
  generated_at: string;
  page: {
    requested_url: string;
    current_url: string | null;
    origin: string | null;
    title: string | null;
    status: RuntimeSessionFacts["current_page"]["status"];
    failure: RuntimeSessionFacts["current_page"]["error_reason"];
  };
  resource_facts: SiteResourceFact[];
  evidence_refs: string[];
  snapshot_ref?: string;
  refmap_ref?: string;
  public_boundary: SiteFactsPublicBoundary;
  unavailable: null;
}

export interface SiteResourceFactsUnavailable {
  status: "unavailable";
  failure_class: "session_missing" | "unsupported_site" | "unsupported_task_kind" | "source_unavailable";
  site_id?: string;
  task_kind?: string;
  message: string;
  retryable: boolean;
  public_boundary: SiteFactsPublicBoundary;
}

interface SiteFactsPublicBoundary {
  output: "public_runtime_facts_and_refs_only";
  raw_credentials: "not_exposed";
  raw_profile_storage: "not_exposed";
  raw_cdp_endpoint: "not_exposed";
  raw_dom: "not_exposed";
  raw_har: "not_exposed";
  raw_network_bodies: "not_exposed";
  screenshot_body: "not_exposed";
  external_write_actions: "not_performed";
}

interface SiteResourceProfile {
  site_id: SiteRuntimeId;
  read_task_kinds: Set<string>;
  write_precheck_task_kinds: Set<string>;
  read_origin_fact_key: string;
  read_allowed_origin: string;
  allowed_write_origins: Set<string>;
  read_fact_keys: string[];
  write_precheck_fact_keys: string[];
}

const PUBLIC_BOUNDARY: SiteFactsPublicBoundary = {
  output: "public_runtime_facts_and_refs_only",
  raw_credentials: "not_exposed",
  raw_profile_storage: "not_exposed",
  raw_cdp_endpoint: "not_exposed",
  raw_dom: "not_exposed",
  raw_har: "not_exposed",
  raw_network_bodies: "not_exposed",
  screenshot_body: "not_exposed",
  external_write_actions: "not_performed"
};

const SITE_PROFILES: Record<SiteRuntimeId, SiteResourceProfile> = {
  xiaohongshu: {
    site_id: "xiaohongshu",
    read_task_kinds: new Set(["read", "read_notes", "search_notes", "read_note_detail", "xhs_search_notes", "xhs_read_note_detail"]),
    write_precheck_task_kinds: new Set(["write_precheck", "publish_note_precheck", "xhs_publish_note_precheck"]),
    read_origin_fact_key: "runtime.origin.www_xiaohongshu_com.available",
    read_allowed_origin: "https://www.xiaohongshu.com",
    allowed_write_origins: new Set(["https://www.xiaohongshu.com", "https://creator.xiaohongshu.com"]),
    read_fact_keys: [
      "runtime.execution_surface.available",
      "runtime.origin.www_xiaohongshu_com.available",
      "identity.user_logged_in.confirmed",
      "page.vue_app.ready",
      "page.pinia_store.ready",
      "source.refs.available",
      "evidence.snapshot_ref.available",
      "safety.challenge.absent"
    ],
    write_precheck_fact_keys: [
      "runtime.execution_surface.available",
      "runtime.public_https_navigation.allowed",
      "runtime.site_identity.logged_in",
      "snapshot.creator_publish_page.available",
      "refmap.write_target_refs.available",
      "evidence.snapshot_ref.available",
      "no_submit_guard.active"
    ]
  },
  boss: {
    site_id: "boss",
    read_task_kinds: new Set(["read", "read_jobs", "search_jobs", "job_search", "read_job_detail", "boss_job_search", "boss_read_job_detail"]),
    write_precheck_task_kinds: new Set(["write_precheck", "greet_precheck", "boss_greet_precheck"]),
    read_origin_fact_key: "runtime.origin.www_zhipin_com.available",
    read_allowed_origin: "https://www.zhipin.com",
    allowed_write_origins: new Set(["https://www.zhipin.com"]),
    read_fact_keys: [
      "runtime.execution_surface.available",
      "runtime.origin.www_zhipin_com.available",
      "identity.boss_geek_logged_in.confirmed",
      "page.boss_spa.ready",
      "network.wapi_zpgeek.available",
      "source.refs.available",
      "evidence.snapshot_ref.available",
      "safety.challenge.absent"
    ],
    write_precheck_fact_keys: [
      "runtime.execution_surface.available",
      "runtime.public_https_navigation.allowed",
      "runtime.site_identity.logged_in",
      "snapshot.job_or_recruiter_target.available",
      "refmap.write_target_refs.available",
      "evidence.snapshot_ref.available",
      "no_submit_guard.active"
    ]
  }
};

export function missingSiteRuntimeSession(runtime_session_ref: string, input: SiteResourceFactsInput = {}): SiteResourceFactsUnavailable {
  return unavailable(
    "session_missing",
    "Runtime Session is missing.",
    true,
    input.site_id,
    input.task_kind ?? inferDefaultTaskKind(input.site_id),
    runtime_session_ref
  );
}

export function createSiteResourceFacts(
  session: RuntimeSessionFacts,
  input: SiteResourceFactsInput,
  capture: SnapshotCaptureResult,
  siteProbe?: LocalProviderSiteResourceProbeResult
): SiteResourceFacts | SiteResourceFactsUnavailable {
  const siteId = normalizeSiteId(input.site_id, session.current_page.current_url ?? session.current_page.requested_url);
  const profile = siteId ? SITE_PROFILES[siteId] : null;
  const taskKind = normalizeTaskKind(input.task_kind ?? inferDefaultTaskKind(siteId));
  if (!profile) return unavailable("unsupported_site", `Unsupported site_id: ${input.site_id ?? "unknown"}.`, false, input.site_id, taskKind);
  if (!supportsTask(profile, taskKind)) {
    return unavailable("unsupported_task_kind", `Unsupported task_kind for ${profile.site_id}: ${taskKind}.`, false, profile.site_id, taskKind);
  }

  const evidenceRefs = capture.status === "captured" ? capture.evidence_refs : [];
  const firstEvidenceRef = evidenceRefs[0];
  const pageUrl = session.current_page.current_url ?? session.current_page.requested_url;
  const pageOrigin = safeOrigin(pageUrl);
  const challengeDetected = isChallengeLike(session.current_page.current_url, session.current_page.title);
  const runtimeReady = isRuntimeReady(session);
  const sourceRefsAvailable = capture.status === "captured";
  const facts = profile.write_precheck_task_kinds.has(taskKind)
    ? writePrecheckFacts(profile, session, pageOrigin, runtimeReady, sourceRefsAvailable, challengeDetected, firstEvidenceRef)
    : readFacts(profile, session, pageOrigin, runtimeReady, sourceRefsAvailable, challengeDetected, firstEvidenceRef, taskKind, siteProbe);

  if (capture.status !== "captured") {
    facts.push({
      key: "source.capture.available",
      state: "unavailable",
      source: "observed",
      severity: "blocking",
      message: capture.message
    });
  }

  return {
    schema_version: HARBOR_SITE_RESOURCE_FACTS_SCHEMA,
    runtime_session_ref: session.runtime_session_ref,
    provider_ref: session.provider_ref,
    profile_ref: session.profile_ref,
    site_id: profile.site_id,
    task_kind: taskKind,
    generated_at: new Date().toISOString(),
    page: {
      requested_url: session.current_page.requested_url,
      current_url: session.current_page.current_url,
      origin: pageOrigin,
      title: session.current_page.title,
      status: session.current_page.status,
      failure: session.current_page.error_reason
    },
    resource_facts: facts,
    evidence_refs: evidenceRefs,
    snapshot_ref: capture.status === "captured" ? capture.snapshot_ref : undefined,
    refmap_ref: capture.status === "captured" ? capture.refmap_ref : undefined,
    public_boundary: PUBLIC_BOUNDARY,
    unavailable: null
  };
}

export function siteResourceElements(input: SiteResourceFactsInput = {}) {
  const siteId = normalizeSiteId(input.site_id);
  const taskKind = normalizeTaskKind(input.task_kind ?? inferDefaultTaskKind(siteId));
  return [
    {
      label: `${siteId ?? "site"} ${taskKind} page surface`,
      role: "document",
      locator_hint: "runtime-session://current-page"
    },
    {
      label: "No-submit guard",
      role: "guard",
      locator_hint: "harbor://guard/no-submit"
    }
  ];
}

function readFacts(
  profile: SiteResourceProfile,
  session: RuntimeSessionFacts,
  pageOrigin: string | null,
  runtimeReady: boolean,
  sourceRefsAvailable: boolean,
  challengeDetected: boolean,
  evidence_ref: string | undefined,
  taskKind: string,
  siteProbe?: LocalProviderSiteResourceProbeResult
): SiteResourceFact[] {
  return profile.read_fact_keys.map((key) => factForKey(key, profile, {
    session,
    pageOrigin,
    runtimeReady,
    sourceRefsAvailable,
    challengeDetected,
    evidence_ref,
    taskKind,
    writePrecheck: false,
    siteProbe
  }));
}

function writePrecheckFacts(
  profile: SiteResourceProfile,
  session: RuntimeSessionFacts,
  pageOrigin: string | null,
  runtimeReady: boolean,
  sourceRefsAvailable: boolean,
  challengeDetected: boolean,
  evidence_ref: string | undefined
): SiteResourceFact[] {
  return profile.write_precheck_fact_keys.map((key) => factForKey(key, profile, {
    session,
    pageOrigin,
    runtimeReady,
    sourceRefsAvailable,
    challengeDetected,
    evidence_ref,
    taskKind: "write_precheck",
    writePrecheck: true
  }));
}

function factForKey(key: string, profile: SiteResourceProfile, context: {
  session: RuntimeSessionFacts;
  pageOrigin: string | null;
  runtimeReady: boolean;
  sourceRefsAvailable: boolean;
  challengeDetected: boolean;
  evidence_ref: string | undefined;
  taskKind: string;
  writePrecheck: boolean;
  siteProbe?: LocalProviderSiteResourceProbeResult;
}): SiteResourceFact {
  if (key === "runtime.execution_surface.available") {
    return context.runtimeReady
      ? available(key, "Runtime Session has an active local browser execution surface.", "observed", context.evidence_ref)
      : blocking(key, context.session.current_error?.message ?? `Runtime lifecycle is ${context.session.lifecycle_state}.`);
  }
  if (key === profile.read_origin_fact_key) {
    return context.pageOrigin === profile.read_allowed_origin
      ? available(key, `Current page origin is ${profile.read_allowed_origin}.`, "observed", context.evidence_ref)
      : blocking(key, `Current page origin is ${context.pageOrigin ?? "unavailable"}, expected ${profile.read_allowed_origin}.`);
  }
  if (key === "runtime.public_https_navigation.allowed") {
    const allowed = context.pageOrigin !== null && profile.allowed_write_origins.has(context.pageOrigin);
    return allowed
      ? available(key, `Current page origin is allowed for ${profile.site_id}.`, "observed", context.evidence_ref)
      : blocking(key, `Current page origin is ${context.pageOrigin ?? "unavailable"}; expected ${[...profile.allowed_write_origins].join(" or ")}.`);
  }
  if (key === "source.refs.available" || key === "evidence.snapshot_ref.available" || key === "refmap.write_target_refs.available") {
    return context.sourceRefsAvailable
      ? available(key, "Harbor produced refs-only snapshot/evidence facts for the current page.", "validation_evidence", context.evidence_ref)
      : blocking(key, "Harbor could not produce current page refs.");
  }
  if (key === "no_submit_guard.active") {
    return available(key, "No-submit guard is active; Harbor does not publish, send, submit, save, delete, or pay.", "configured", context.evidence_ref);
  }
  if (key === "safety.challenge.absent") {
    if (context.siteProbe && "failure_class" in context.siteProbe && context.siteProbe.failure_class === "safety_challenge") {
      return blocked(key, context.siteProbe.message);
    }
    return context.challengeDetected
      ? blocked(key, "Visible URL/title suggests login, CAPTCHA, verification, or safety challenge; manual handling is required.")
      : available(key, "No login, CAPTCHA, verification, or safety challenge is visible from public page facts.", "derived", context.evidence_ref);
  }
  if (key === "identity.user_logged_in.confirmed" || key === "identity.boss_geek_logged_in.confirmed" || key === "runtime.site_identity.logged_in") {
    if (context.siteProbe && "failure_class" in context.siteProbe && context.siteProbe.failure_class === "not_logged_in") {
      return blocked(key, context.siteProbe.message);
    }
    if (isFixtureRuntime(context.session)) {
      return available(key, "Fixture launcher supplies logged-in state only for local packaged runtime smoke.", "validation_evidence", context.evidence_ref);
    }
    return isLoginLike(context.session.current_page.current_url, context.session.current_page.title)
      ? blocking(key, "Current public page facts suggest login is required.")
      : unknown(
        key,
        "Harbor has no safe site-specific login probe in this endpoint; Core must treat this as admission-unknown until live profile facts confirm it."
      );
  }
  if ((key === "page.vue_app.ready" || key === "page.pinia_store.ready" || key === "page.boss_spa.ready") && context.siteProbe) {
    const evidenceRef = "evidence_ref" in context.siteProbe ? context.siteProbe.evidence_ref : undefined;
    if (context.siteProbe.status === "blocked") return blocked(key, context.siteProbe.message);
    if (context.siteProbe.verified_fact_keys.some((candidate) => candidate === key)) {
      const message = key === "page.boss_spa.ready"
        ? "Controlled CDP probe verified the canonical rendered BOSS SPA job-search surface."
        : key === "page.vue_app.ready"
          ? "Controlled CDP probe verified the Xiaohongshu Vue app readiness signal."
          : "Controlled CDP probe verified the Xiaohongshu Pinia store readiness signal.";
      return available(key, message, "validation_evidence", evidenceRef);
    }
    if (context.siteProbe.status === "unavailable") return blocking(key, context.siteProbe.message);
    if (context.siteProbe.status === "available") {
      return unknown(key, "The controlled site-resource probe did not verify this readiness signal.");
    }
    return unknown(key, context.siteProbe.message);
  }
  if (key === "network.wapi_zpgeek.available") {
    return unknown(key, "The exact query-bound BOSS WAPI response is deferred to the allowlisted read-operation probe; pre-admission does not synthesize it.");
  }
  if (key === "page.vue_app.ready" || key === "page.pinia_store.ready" || key === "page.boss_spa.ready") {
    if (isFixtureRuntime(context.session)) {
      return available(key, "Fixture launcher supplies site readiness only for local packaged runtime smoke.", "validation_evidence", context.evidence_ref);
    }
    return context.challengeDetected
      ? blocked(key, "Page readiness cannot be accepted while a visible challenge is present.")
      : unknown(key, "Harbor did not expose raw DOM, network bodies, or app store internals; readiness remains unknown until a safe probe produces a ref.");
  }
  if (key === "snapshot.creator_publish_page.available" || key === "snapshot.job_or_recruiter_target.available") {
    return context.sourceRefsAvailable
      ? available(key, "Harbor captured refs-only target page context for validate-only write precheck.", "validation_evidence", context.evidence_ref)
      : blocking(key, "Target page snapshot refs are unavailable.");
  }
  if (key === "input.signed_note_ref.available" || key === "input.boss_security_id.available") {
    return unknown(key, `Input-specific ${key} is supplied by Core task input or prior result refs, not by Harbor page facts.`);
  }
  return unknown(key, "Harbor has no public probe for this resource fact.");
}

function supportsTask(profile: SiteResourceProfile, taskKind: string): boolean {
  return profile.read_task_kinds.has(taskKind) || profile.write_precheck_task_kinds.has(taskKind);
}

function available(key: string, message: string, source: SiteResourceFactSource, evidence_ref?: string): SiteResourceFact {
  return { key, state: "available", source, severity: "info", message, evidence_ref };
}

function blocked(key: string, message: string): SiteResourceFact {
  return { key, state: "blocked", source: "observed", severity: "blocking", message };
}

function blocking(key: string, message: string): SiteResourceFact {
  return { key, state: "unavailable", source: "observed", severity: "blocking", message };
}

function unknown(key: string, message: string): SiteResourceFact {
  return { key, state: "unknown", source: "derived", severity: "warning", message };
}

function normalizeTaskKind(value: string): string {
  return value.trim().toLowerCase().replace(/-/g, "_");
}

function normalizeSiteId(value?: string, url?: string | null): SiteRuntimeId | null {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "xiaohongshu" || normalized === "xhs") return "xiaohongshu";
  if (normalized === "boss" || normalized === "zhipin" || normalized === "boss_zhipin") return "boss";
  if (normalized) return null;
  const origin = safeOrigin(url);
  if (origin === "https://www.xiaohongshu.com" || origin === "https://creator.xiaohongshu.com") return "xiaohongshu";
  if (origin === "https://www.zhipin.com") return "boss";
  return null;
}

function inferDefaultTaskKind(site_id?: string | null): string {
  if (site_id === "boss") return "job_search";
  return "search_notes";
}

function isRuntimeReady(session: RuntimeSessionFacts): boolean {
  return isRuntimeSessionReadable(session) && session.availability.cdp === "available";
}

function safeOrigin(url?: string | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.origin;
  } catch {
    return null;
  }
}

function isChallengeLike(url?: string | null, title?: string | null): boolean {
  const text = `${url ?? ""} ${title ?? ""}`.toLowerCase();
  return /captcha|challenge|verify|verification|security|安全|验证|校验/.test(text);
}

function isLoginLike(url?: string | null, title?: string | null): boolean {
  const text = `${url ?? ""} ${title ?? ""}`.toLowerCase();
  return /login|signin|sign-in|登录|登陆/.test(text);
}

function isFixtureRuntime(session: RuntimeSessionFacts): boolean {
  return session.facts.some((fact) => fact.key === "cdp.version" && String(fact.value).startsWith("FixtureBrowser "));
}

function unavailable(
  failure_class: SiteResourceFactsUnavailable["failure_class"],
  message: string,
  retryable: boolean,
  site_id?: string,
  task_kind?: string,
  runtime_session_ref?: string
): SiteResourceFactsUnavailable {
  return {
    status: "unavailable",
    failure_class,
    site_id,
    task_kind,
    message: runtime_session_ref ? `${message} (${runtime_session_ref})` : message,
    retryable,
    public_boundary: PUBLIC_BOUNDARY
  };
}
