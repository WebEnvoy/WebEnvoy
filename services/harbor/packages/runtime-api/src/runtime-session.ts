import { createHash } from "node:crypto";
import { isTrustedEnvironmentProbe, profileEnvironmentConfiguration, profileEnvironmentState, type EnvironmentObservation, type EnvironmentProbe, type ProfileEnvironmentConfiguration } from "./profile-environment.js";
import { isTrustedManagedInteractionOperation, type ManagedInteractionOperation, type ManagedInteractionResult } from "./managed-interaction.js";
import type { ManagedInteractionRequest } from "./managed-interaction-request.js";
import { isTrustedManagedPublicPageOperation, type ManagedPageSelector, type ManagedPublicPageInput, type ManagedPublicPageOperation, boundedManagedRef, isTrustedManagedPageObserver, managedUnavailable, type ManagedObservation, type ManagedObservationInput, type ManagedObservationUnavailable, type ManagedProviderObservation, type ManagedProviderPageInput } from "./managed-observation.js";
import { assertNoUnfinishedProfileRecovery } from "./profile-recovery.js";
import {
  createLocalIdentityEnvironmentFacts,
  HARBOR_LOCAL_IDENTITY_ENVIRONMENT_SCHEMA,
  type LocalIdentityEnvironmentFacts,
  type LocalIdentityEnvironmentInput
} from "./identity-environment.js";
import { opaqueRef } from "./refs.js";
import {
  acquireProfileStorageOwnership,
  profileStorageHasExternalLock,
  type ProfileStorageOwnershipLock
} from "./profile-storage.js";
import {
  HARBOR_RUNTIME_FACTS_SCHEMA,
  HARBOR_VALIDATION_RUNTIME_FACTS_SCHEMA,
  isRuntimeSessionReadable,
  type CreateRuntimeSessionInput,
  type LocalProviderMediaActionInput,
  type LocalProviderMediaActionResult,
  type LocalProviderLauncher,
  type LocalProviderPageFacts,
  type LocalProviderReadProbeInput,
  type LocalProviderReadProbePublicSummary,
  type LocalProviderReadProbeResult,
  type LocalProviderScreenshotFacts,
  type LocalProviderSiteResourceProbeInput,
  type LocalProviderSiteResourceProbeResult,
  type LocalProviderWritePrecheckProbeInput,
  type LocalProviderWritePrecheckProbeResult,
  type OpenIdentityEnvironmentSessionInput,
  type RuntimeErrorCode,
  type RuntimeErrorFact,
  type RuntimeFact,
  type RuntimePageFacts,
  type RuntimeSessionControlInput,
  type RuntimeSessionFacts,
  type RuntimeSessionUnavailable,
  type RuntimeViewerEntry,
  type ValidationRuntimeFacts
} from "./runtime-session-types.js";
import {
  isTrustedLocalProviderMediaActionProbe,
  isTrustedLocalProviderReadProbe,
  isTrustedLocalProviderSiteResourceProbe,
  isTrustedLocalProviderWritePrecheckProbe
} from "./read-operation-probe-trust.js";
import { diagnosticsUnavailable, isTrustedRuntimeDiagnosticsProbe, type RuntimeDiagnosticsInput, type RuntimeDiagnosticsResponse } from "./runtime-diagnostics.js";
import {
  PageRegistry,
  createLegacyPageController,
  pageNavigationFailureClass,
  type ManagedPageFacts,
  type ManagedPageList,
  type ManagedPageOperationReceipt,
  type ManagedPageOperationInput,
  type ManagedPageUnavailable
} from "./page-navigation.js";
import type {
  ControlOwner,
  ControlOwnerFacts,
  ViewerControlStore
} from "./viewer-control.js";

export {
  HARBOR_RUNTIME_FACTS_SCHEMA,
  HARBOR_VALIDATION_RUNTIME_FACTS_SCHEMA
} from "./runtime-session-types.js";
export type {
  AvailabilityState,
  CreateRuntimeSessionInput,
  FactSource,
  LifecycleState,
  LocalProviderLauncher,
  LocalProviderLaunchInput,
  LocalProviderLaunchResult,
  LocalProviderDriverKind,
  LocalProviderMediaActionInput,
  LocalProviderMediaActionResult,
  LocalProviderPageFacts,
  LocalProviderPageController,
  LocalProviderPageState,
  LocalProviderReadProbeInput,
  LocalProviderReadProbePublicSummary,
  LocalProviderReadProbeResult,
  LocalProviderScreenshotFacts,
  LocalProviderSiteResourceProbeInput,
  LocalProviderSiteResourceReadinessFactKey,
  LocalProviderSiteResourceProbeResult,
  LocalProviderWritePrecheckProbeInput,
  LocalProviderWritePrecheckProbeResult,
  XhsPathPrepareBusinessState,
  XhsPathPrepareCompositionState,
  XhsPathPrepareNormalizedState,
  XhsPathPrepareObservedPath,
  XhsPathPrepareRequestedPath,
  XhsWritePrecheckCompositionPath,
  XhsWritePrecheckCompositionState,
  XhsWritePrecheckFieldState,
  XhsWritePrecheckMediaState,
  XhsWritePrecheckObservationStatus,
  XhsPublicObservation,
  XhsPublicObservationExpected,
  XhsPublicObservationExpectedMatch,
  XhsPublicObservationFieldSummary,
  XhsPublicObservationLabelRef,
  XhsPublicObservationPendingIssueCode,
  OpenIdentityEnvironmentSessionInput,
  ProviderMode,
  RuntimeControlLockFacts,
  RuntimeControlLockState,
  RuntimeErrorCode,
  RuntimeErrorFact,
  RuntimeFact,
  RuntimePageFacts,
  RuntimePageStatus,
  RuntimeSessionControlInput,
  RuntimeSessionFacts,
  RuntimeSessionUnavailable,
  RuntimeViewerEntry,
  ValidationRuntimeFacts
} from "./runtime-session-types.js";
export { HARBOR_PAGE_LIST_SCHEMA, HARBOR_PAGE_NAVIGATION_SCHEMA, MAX_PAGE_OBJECTS, MAX_PAGE_TOMBSTONES, PageRegistry } from "./page-navigation.js";
export type { ManagedPageFacts, ManagedPageList, ManagedPageOperation, ManagedPageOperationInput, ManagedPageOperationReceipt, ManagedPageUnavailable, ManagedPageUnavailableClass } from "./page-navigation.js";

export interface RuntimeSessionRecord {
  facts: RuntimeSessionFacts;
  control_generation: number;
  active_provider_interactions: number;
  closing?: Promise<RuntimeSessionFacts>;
  headless: boolean;
  identity_binding: {
    profile_storage_ref: string | null;
  };
  user_held_session: boolean;
  read_operation_user_confirmed: boolean;
  read_operation_user_release_pending: boolean;
  read_operation_user_handoff: boolean;
  execution_surface: "local_provider" | "fixture" | "unknown";
  profile_ownership?: ProfileStorageOwnershipLock;
  openUrl?: (url: string, operation_scope?: "profile_management") => Promise<LocalProviderPageFacts>;
  clearPublicPageGuard?: () => Promise<void>;
  publicPage?: ManagedPublicPageOperation;
  interaction?: ManagedInteractionOperation;
  interaction_snapshot?: { page_ref: string; provider_snapshot_ref?: string; observation_ref: string; control_generation: number; holder_ref: string };
  observePage?: (input?: ManagedProviderPageInput) => Promise<ManagedProviderObservation>;
  readDiagnostics?: (input: RuntimeDiagnosticsInput) => Promise<RuntimeDiagnosticsResponse>;
  readEnvironment?: EnvironmentProbe;
  applied_environment?: ProfileEnvironmentConfiguration;
  environment_observation?: EnvironmentObservation;
  managed_observations?: ManagedObservation[];
  page_registry?: PageRegistry;
  probeReadOperation?: (input: LocalProviderReadProbeInput) => Promise<LocalProviderReadProbeResult>;
  probeSiteResource?: (input: LocalProviderSiteResourceProbeInput) => Promise<LocalProviderSiteResourceProbeResult>;
  probeWritePrecheck?: (input: LocalProviderWritePrecheckProbeInput) => Promise<LocalProviderWritePrecheckProbeResult>;
  executeMediaAction?: (input: LocalProviderMediaActionInput) => Promise<LocalProviderMediaActionResult>;
  captureScreenshot?: () => Promise<LocalProviderScreenshotFacts | RuntimeErrorFact>;
  close?: () => Promise<void>;
}

const baselineFacts: RuntimeFact[] = [
  { key: "provider.mode", source: "configured", value: "local_dedicated_profile" },
  { key: "provider.binary_boundary", source: "configured", value: "user_provided_browser" },
  { key: "provider.license_boundary", source: "configured", value: "user_provided_local_browser_license" },
  { key: "provider.anti_detection_success", source: "provider_claim", value: "not_claimed" }
];

export class RuntimeSessionStore {
  private readonly records = new Map<string, RuntimeSessionRecord>();
  private readonly interactionReceipts = new Map<string, { request_hash: string; result: ManagedInteractionResult & { operation_ref: string; runtime_session_ref: string; observed_at: string } }>();
  private readonly openingIdentityEnvironmentRefs = new Set<string>();
  private readonly openingProfileStorageRefs = new Set<string>();
  private readonly mutatingIdentityEnvironmentRefs = new Set<string>();
  private readonly mutatingProfileStorageRefs = new Set<string>();
  private readonly diagnosticsCursorBindings = new Map<string, Map<string, string>>();

  constructor(
    private readonly viewerControls: ViewerControlStore,
    private readonly launcher: LocalProviderLauncher,
    private readonly launchOptions: {
      resolve_proxy?: (proxy_ref: string) => string | null;
      on_session_closed?: (runtime_session_ref: string) => void;
    } = {}
  ) {}

  async createSession(input: CreateRuntimeSessionInput = {}): Promise<RuntimeSessionFacts> {
    const appliedEnvironment = input.managed_identity_environment ? profileEnvironmentConfiguration(input.managed_identity_environment) : undefined;
    const now = new Date().toISOString();
    const provider_ref = input.provider_ref ?? opaqueRef("provider");
    const profile_ref = input.profile_ref ?? opaqueRef("profile");
    const requestedUrl = input.url ?? "about:blank";
    const controlOwner = input.control_owner ?? "system";
    const headless = input.headless ?? controlOwner !== "user";
    let profileOwnership: ProfileStorageOwnershipLock | null = null;
    const launch = await (async () => {
      if (input.identity_environment_ref) this.openingIdentityEnvironmentRefs.add(input.identity_environment_ref);
      if (input.profile_storage_ref) this.openingProfileStorageRefs.add(input.profile_storage_ref);
      try {
        if (input.profile_storage_ref) {
          try {
            profileOwnership = acquireProfileStorageOwnership([input.profile_storage_ref]);
          } catch {
            return { status: "unavailable" as const, error: error("profile_locked", "Profile storage is owned by another Runtime.", true), facts: [] };
          }
          if (profileStorageHasExternalLock(input.profile_storage_ref)) {
            profileOwnership.release();
            profileOwnership = null;
            return { status: "unavailable" as const, error: error("profile_locked", "Profile storage is locked by an external browser.", true), facts: [] };
          }
          try { assertNoUnfinishedProfileRecovery(input.profile_storage_ref, profile_ref); }
          catch {
            profileOwnership.release();
            profileOwnership = null;
            return { status: "unavailable" as const, error: error("recovery_operation_unfinished", "Query the original recovery operation before starting this Profile.", false), facts: [] };
          }
        }
        const result = await this.launcher({
          operation_scope: input.operation_scope,
          browser_path: input.browser_path ?? "",
          provider_id: input.provider_id,
          headless,
          timeout_ms: input.timeout_ms ?? 15_000,
          url: requestedUrl,
          profile_ref,
          profile_storage_ref: input.profile_storage_ref,
          provider_ref,
          identity_environment: input.managed_identity_environment,
          resolve_proxy: this.launchOptions.resolve_proxy
        });
        if (result.status !== "ready" || (input.profile_storage_ref && profileStorageHasExternalLock(input.profile_storage_ref))) {
          profileOwnership?.release();
          profileOwnership = null;
        }
        return result;
      } catch (cause) {
        profileOwnership?.release();
        profileOwnership = null;
        throw cause;
      } finally {
        if (input.identity_environment_ref) this.openingIdentityEnvironmentRefs.delete(input.identity_environment_ref);
        if (input.profile_storage_ref) this.openingProfileStorageRefs.delete(input.profile_storage_ref);
      }
    })();
    const runtime_session_ref = opaqueRef("session");
    const ready = launch.status === "ready";
    const viewer_entry: RuntimeViewerEntry = ready ? launch.viewer_entry : {
      availability: "unsupported",
      access_mode: "none",
      transport: "not_applicable",
      input_capabilities: [],
      unavailable_reason: "unsupported"
    };
    const current_error = ready ? launch.page.error ?? null : launch.error;
    const current_page = ready ? pageFacts(requestedUrl, launch.page, now) : unavailablePage(requestedUrl, launch.error, now);
    const facts: RuntimeSessionFacts = {
      schema_version: HARBOR_RUNTIME_FACTS_SCHEMA,
      runtime_session_ref,
      identity_environment_ref: input.identity_environment_ref,
      execution_identity_ref: input.execution_identity_ref,
      profile_ref,
      provider_ref,
      provider_mode: "local_dedicated_profile",
      lifecycle_state: ready ? "active" : "failed",
      created_at: now,
      last_seen_at: now,
      availability: {
        driver: ready ? (launch.driver_ref || launch.cdp_ref ? "available" : "unsupported") : "unavailable",
        cdp: ready ? (launch.cdp_ref ? "available" : "unsupported") : "unavailable",
        viewer: viewerAvailabilityState(viewer_entry.availability),
        snapshot: "unavailable",
        evidence: "unavailable"
      },
      driver_ref: ready ? launch.driver_ref : undefined,
      driver_kind: ready ? launch.driver_kind : undefined,
      cdp_ref: ready ? launch.cdp_ref : undefined,
      viewer_entry,
      current_page,
      control_owner: ready ? controlOwner : "none",
      control_lock: {
        owner: ready ? controlOwner : "none",
        state: ready ? "held" : "released",
        holder_ref: ready ? input.holder_ref ?? controlOwner : null,
        updated_at: now,
        conflict_error: null
      },
      current_error,
      facts: [...baselineFacts, ...launch.facts]
    };
    const viewerControl = this.viewerControls.create(facts, now);
    facts.viewer_ref = viewerControl.viewer.viewer_ref;
    facts.facts.push(
      { key: "page.requested_url", source: "configured", value: requestedUrl },
      { key: "page.current_url", source: ready ? "observed" : "configured", value: current_page.current_url ?? "unavailable" },
      { key: "page.title", source: ready ? "observed" : "configured", value: current_page.title ?? "unavailable" },
      { key: "page.status", source: ready ? "observed" : "configured", value: current_page.status },
      { key: "viewer.ref", source: "configured", value: viewerControl.viewer.viewer_ref },
      { key: "viewer.availability", source: "configured", value: viewerControl.viewer.availability },
      { key: "viewer.transport", source: "configured", value: viewerControl.viewer.transport },
      { key: "control.owner", source: "configured", value: viewerControl.control.owner },
      { key: "control.lock_state", source: "configured", value: facts.control_lock.state },
      { key: "lifecycle.reference.donut_browser", source: "configured", value: "mechanism_reference_only" }
    );
    const legacyProviderPageRef = opaqueRef("provider_page");
    const pageController = ready
      ? launch.pageController ?? createLegacyPageController({ ...launch.page, provider_page_ref: legacyProviderPageRef, active: true }, launch.openUrl)
      : undefined;
    const initialPages = ready
      ? launch.pages ?? [{ ...launch.page, provider_page_ref: legacyProviderPageRef, active: true }]
      : [];
    this.records.set(runtime_session_ref, {
      facts,
      control_generation: 0,
      active_provider_interactions: 0,
      headless,
      identity_binding: {
        profile_storage_ref: input.profile_storage_ref ?? null
      },
      // HTTP session creation carries no authenticated user-handoff fact.
      user_held_session: false,
      read_operation_user_confirmed: false,
      read_operation_user_release_pending: false,
      read_operation_user_handoff: false,
      execution_surface: ready ? launch.execution_surface ?? "unknown" : "unknown",
      profile_ownership: profileOwnership ?? undefined,
      openUrl: ready ? launch.openUrl : undefined,
      clearPublicPageGuard: ready ? launch.clearPublicPageGuard : undefined,
      publicPage: ready ? launch.publicPage : undefined,
      interaction: ready ? launch.interaction : undefined,
      observePage: ready ? launch.observePage : undefined,
      readDiagnostics: ready ? launch.readDiagnostics : undefined,
      readEnvironment: ready ? launch.readEnvironment : undefined,
      applied_environment: ready ? appliedEnvironment : undefined,
      probeReadOperation: ready ? launch.probeReadOperation : undefined,
      probeSiteResource: ready ? launch.probeSiteResource : undefined,
      probeWritePrecheck: ready ? launch.probeWritePrecheck : undefined,
      executeMediaAction: ready ? launch.executeMediaAction : undefined,
      captureScreenshot: ready ? launch.captureScreenshot : undefined,
      close: ready ? launch.close : undefined,
      page_registry: pageController ? new PageRegistry(runtime_session_ref, pageController, initialPages) : undefined
    });
    if (ready && input.managed_identity_environment) await this.readProfileEnvironment(input.managed_identity_environment);
    return snapshot(facts);
  }

  async readProfileEnvironment(identity: LocalIdentityEnvironmentFacts) {
    const session = this.getActiveIdentityEnvironmentSession(identity.identity_environment_ref);
    const record = session ? this.records.get(session.runtime_session_ref) : undefined;
    const active = record && ["active", "locked", "idle"].includes(record.facts.lifecycle_state) ? record : undefined;
    let observation: EnvironmentObservation | null = null;
    if (active && active.execution_surface === "local_provider" && !active.active_provider_interactions && isTrustedEnvironmentProbe(active.readEnvironment)) {
      active.active_provider_interactions += 1;
      try {
        observation = await active.readEnvironment();
        if (observation) active.environment_observation = observation;
      } catch { observation = null; }
      finally { active.active_provider_interactions -= 1; }
    }
    return profileEnvironmentState(identity, active?.facts.runtime_session_ref ?? null, active?.applied_environment ?? null,
      observation, active?.environment_observation?.observed_at ?? null);
  }

  getSession(runtime_session_ref: string): RuntimeSessionFacts | null {
    const facts = this.records.get(runtime_session_ref)?.facts;
    return facts ? snapshot(facts) : null;
  }

  getActiveIdentityEnvironmentSession(identity_environment_ref: string): RuntimeSessionFacts | null {
    for (const record of this.records.values()) {
      if (record.facts.identity_environment_ref === identity_environment_ref &&
        retainsRuntimeResources(record)) {
        return snapshot(record.facts);
      }
    }
    return null;
  }

  isIdentityEnvironmentInUse(identity_environment_ref: string): boolean {
    return this.openingIdentityEnvironmentRefs.has(identity_environment_ref) || Boolean(this.getActiveIdentityEnvironmentSession(identity_environment_ref));
  }

  isProfileStorageInUse(profile_storage_ref: string): boolean {
    if (this.openingProfileStorageRefs.has(profile_storage_ref)) return true;
    for (const record of this.records.values()) {
      if (record.identity_binding.profile_storage_ref === profile_storage_ref &&
        retainsRuntimeResources(record)) return true;
    }
    return false;
  }

  reserveIdentityEnvironmentMutation(
    identityEnvironmentRefs: readonly string[],
    profileStorageRefs: readonly string[]
  ): (() => void) | null {
    const identities = [...new Set(identityEnvironmentRefs)];
    const profiles = [...new Set(profileStorageRefs)];
    if (identities.some((ref) => this.openingIdentityEnvironmentRefs.has(ref) || this.mutatingIdentityEnvironmentRefs.has(ref) || this.getActiveIdentityEnvironmentSession(ref)) ||
      profiles.some((ref) => this.openingProfileStorageRefs.has(ref) || this.mutatingProfileStorageRefs.has(ref) || this.isProfileStorageInUse(ref))) {
      return null;
    }
    identities.forEach((ref) => this.mutatingIdentityEnvironmentRefs.add(ref));
    profiles.forEach((ref) => this.mutatingProfileStorageRefs.add(ref));
    let released = false;
    return () => {
      if (released) return;
      released = true;
      identities.forEach((ref) => this.mutatingIdentityEnvironmentRefs.delete(ref));
      profiles.forEach((ref) => this.mutatingProfileStorageRefs.delete(ref));
    };
  }

  getRecord(runtime_session_ref: string): RuntimeSessionRecord | undefined {
    return this.records.get(runtime_session_ref);
  }

  async listManagedPages(runtime_session_ref: string, authorized_origins: readonly string[] = []): Promise<ManagedPageList | ManagedPageUnavailable> {
    const record = this.records.get(runtime_session_ref);
    if (!record) return pageUnavailable("session_missing", runtime_session_ref, true);
    if (!isRuntimeSessionReadable(record.facts)) return pageUnavailable("session_not_ready", runtime_session_ref, true);
    if (!record.page_registry) return pageUnavailable("provider_unavailable", runtime_session_ref, true);
    try {
      await record.page_registry.refresh();
      return record.page_registry.list(authorized_origins);
    } catch (cause) {
      return pageUnavailable(pageFailureClass(cause), runtime_session_ref, true);
    }
  }

  getManagedPageOperation(operation_ref: string): ManagedPageOperationReceipt | null {
    return this.records.size === 0 ? null : [...this.records.values()].map(record => record.page_registry?.getOperation(operation_ref)).find(Boolean) ?? null;
  }

  async operateManagedPage(runtime_session_ref: string, input: ManagedPageOperationInput): Promise<ManagedPageOperationReceipt | ManagedPageList | ManagedPageUnavailable> {
    if (input.operation === "page.list") return this.listManagedPages(runtime_session_ref, input.authorized_origins ?? []);
    const record = this.records.get(runtime_session_ref);
    if (!record) return pageUnavailable("session_missing", runtime_session_ref, true, input.operation_ref);
    if (!isRuntimeSessionReadable(record.facts)) return pageUnavailable("session_not_ready", runtime_session_ref, true, input.operation_ref);
    if (!record.page_registry) return pageUnavailable("provider_unavailable", runtime_session_ref, true, input.operation_ref);
    if (record.facts.control_owner !== "core_task" || record.facts.control_lock.state !== "held" ||
      record.facts.control_lock.holder_ref !== input.holder_ref) return pageUnavailable("control_lock_conflict", runtime_session_ref, true, input.operation_ref);
    if (record.active_provider_interactions) return pageUnavailable("control_lock_conflict", runtime_session_ref, true, input.operation_ref);
    const generation = record.control_generation;
    try {
      const result = await this.withProviderInteraction(record, () => record.page_registry!.operateReceipt(input));
      if (record.control_generation !== generation) return pageUnavailable("control_lock_conflict", runtime_session_ref, true, input.operation_ref, result.dispatch_state);
      if (result.status === "completed" && result.page) {
        record.facts.current_page = pageFacts(result.page.requested_url, { ...result.page, facts: [] }, result.page.observed_at);
      }
      return result;
    } catch {
      // The registry may already have persisted a receipt before an outer
      // bookkeeping/error path failed. Preserve that evidence verbatim. If
      // no receipt is readable, the Provider call may still have crossed its
      // dispatch boundary, so report an unknown dispatched outcome and never
      // downgrade it to `not_dispatched`.
      const receipt = input.operation_ref ? record.page_registry.getOperation(input.operation_ref) : undefined;
      if (receipt) return receipt;
      return pageUnavailable("unknown_outcome", runtime_session_ref, true, input.operation_ref, "dispatched");
    }
  }

  async openIdentityEnvironmentSession(input: OpenIdentityEnvironmentSessionInput): Promise<RuntimeSessionFacts | RuntimeSessionUnavailable> {
    const urlError = validateRuntimeUrl(input.url);
    if (urlError) return unavailableSession("url_unreachable", urlError);

    const identityEnvironment = isLocalIdentityEnvironmentFacts(input.identity_environment)
      ? input.identity_environment
      : createLocalIdentityEnvironmentFacts(input.identity_environment);
    if (input.provider_id && input.provider_id !== identityEnvironment.provider_binding.selected_provider_id) {
      return unavailableSession("identity_environment_unavailable", error(
        "identity_environment_unavailable",
        "provider_mismatch: Requested provider does not match the managed identity binding."
      ));
    }
    if ((input.profile_ref && input.profile_ref !== identityEnvironment.profile_ref) ||
      (input.profile_storage_ref && input.profile_storage_ref !== identityEnvironment.browser_storage.profile_storage_ref)) {
      return unavailableSession("identity_environment_unavailable", error(
        "identity_environment_unavailable",
        "profile_mismatch: Requested Profile does not match the managed identity binding."
      ));
    }
    if (input.execution_identity_ref && input.execution_identity_ref !== identityEnvironment.execution_identity_ref) {
      return unavailableSession("identity_environment_unavailable", error(
        "identity_environment_unavailable",
        "identity_mismatch: Requested execution identity does not match the managed identity binding."
      ));
    }
    const identityError = identityEnvironmentUnavailable(identityEnvironment);
    if (identityError) return unavailableSession("identity_environment_unavailable", identityError);
    if (this.mutatingIdentityEnvironmentRefs.has(identityEnvironment.identity_environment_ref) ||
      this.mutatingProfileStorageRefs.has(identityEnvironment.browser_storage.profile_storage_ref)) {
      return unavailableSession("session_locked", error("session_locked", "Identity environment is reserved by a local mutation.", true));
    }

    const owner = input.control_owner ?? "agent";
    const holder = input.holder_ref ?? owner;
    const headless = input.headless ?? owner !== "user";
    const existing = this.findIdentitySession(
      identityEnvironment.profile_ref,
      identityEnvironment.identity_environment_ref,
      identityEnvironment.execution_identity_ref
    );
    if (existing?.facts.current_error?.code === "session_lost") {
      return unavailableSession("session_missing", existing.facts.current_error!);
    }
    if (
      existing?.facts.lifecycle_state === "disconnected" ||
      existing?.facts.current_error?.code === "session_cleanup_failed"
    ) return cleanupFailed();
    if (input.reuse_existing !== false && existing && (
      existing.headless === headless ||
      (owner === "agent" && input.headless === undefined && !existing.headless) ||
      (owner === "core_task" && !existing.headless &&
        (existing.read_operation_user_release_pending || existing.read_operation_user_confirmed))
    )) {
      const conflict = this.acquireControl(existing, owner, holder);
      if (conflict) return conflict;
      try {
        if (existing.openUrl) this.applyPageFacts(existing, input.url, await this.withProviderInteraction(existing, () => existing.openUrl!(input.url!, input.operation_scope)));
      } catch {
        this.markDriverLost(existing);
      }
      if ((existing.facts.current_error as RuntimeErrorFact | null)?.code === "session_lost") {
        return unavailableSession("session_missing", existing.facts.current_error!);
      }
      return snapshot(existing.facts);
    }

    if (existing) {
      if (
        existing.read_operation_user_release_pending &&
        owner !== "core_task" &&
        !(owner === "user" && existing.headless && !headless)
      ) return lockConflict(existing, owner);
      if (hasControlConflict(existing, owner, holder)) return lockConflict(existing, owner);
      try {
        const closed = await this.closeSession(existing.facts.runtime_session_ref);
        if (closed?.lifecycle_state !== "closed") return cleanupFailed();
      } catch {
        return cleanupFailed();
      }
    }

    if (this.openingIdentityEnvironmentRefs.has(identityEnvironment.identity_environment_ref)) {
      return unavailableSession("session_locked", error("session_locked", "Identity environment is already opening.", true));
    }

    return this.createSession({
      ...input,
      browser_path: undefined,
      url: input.url,
      identity_environment_ref: identityEnvironment.identity_environment_ref,
      execution_identity_ref: identityEnvironment.execution_identity_ref,
      profile_ref: identityEnvironment.profile_ref,
      profile_storage_ref: identityEnvironment.browser_storage.profile_storage_ref,
      managed_identity_environment: identityEnvironment,
      control_owner: owner,
      holder_ref: holder,
      headless
    });
  }

  lockSession(runtime_session_ref: string, input: RuntimeSessionControlInput = {}): RuntimeSessionFacts | RuntimeSessionUnavailable {
    const record = this.records.get(runtime_session_ref);
    if (!record) return unavailableSession("session_missing", error("session_lost", "Runtime Session is missing.", true));
    const owner = input.control_owner ?? "user";
    const holder_ref = input.holder_ref ?? owner;
    const preserveReleasedSnapshotGeneration = canPreserveReleasedSnapshotGeneration(record, owner, holder_ref);
    const conflict = this.acquireControl(record, owner, holder_ref);
    if (conflict) return conflict;
    const now = new Date().toISOString();
    record.facts.lifecycle_state = "locked";
    record.facts.last_seen_at = now;
    record.facts.control_lock.state = "held";
    record.facts.control_lock.updated_at = now;
    if (!preserveReleasedSnapshotGeneration) bumpControlGeneration(record);
    record.facts.facts.push({ key: "session.lock", source: "observed", value: record.facts.control_owner });
    return snapshot(record.facts);
  }

  releaseSession(runtime_session_ref: string, input: RuntimeSessionControlInput = {}): RuntimeSessionFacts | RuntimeSessionUnavailable {
    const record = this.records.get(runtime_session_ref);
    if (!record) return unavailableSession("session_missing", error("session_lost", "Runtime Session is missing.", true));
    if (record.facts.lifecycle_state !== "active" && record.facts.lifecycle_state !== "locked") {
      return unavailableSession("session_cleanup_failed", error("session_cleanup_failed", "Runtime Session is not releasable.", true));
    }
    if (record.active_provider_interactions > 0) return unavailableSession("session_locked", error("session_locked", "Provider interaction is still in progress.", true));
    const owner = input.control_owner;
    if (owner && record.facts.control_lock.owner !== owner && record.facts.control_lock.state === "held") return lockConflict(record, owner);

    const confirmedReadControllerRelease = record.read_operation_user_confirmed &&
      record.facts.control_lock.state === "held" && (
        (record.facts.control_owner === "user" && record.facts.control_lock.owner === "user") ||
        (record.read_operation_user_handoff && record.facts.control_owner === "core_task" && record.facts.control_lock.owner === "core_task")
      );
    const now = new Date().toISOString();
    record.facts.lifecycle_state = "idle";
    record.facts.last_seen_at = now;
    record.facts.control_owner = "none";
    record.facts.control_lock = {
      owner: "none",
      state: "released",
      holder_ref: null,
      updated_at: now,
      conflict_error: null
    };
    bumpControlGeneration(record);
    record.user_held_session = false;
    record.read_operation_user_release_pending = confirmedReadControllerRelease;
    record.read_operation_user_handoff = false;
    this.viewerControls.recordHandoff(runtime_session_ref, { control_owner: "none" });
    record.facts.facts.push({ key: "session.release", source: "observed", value: owner ?? "unscoped" });
    return snapshot(record.facts);
  }

  async stopSession(runtime_session_ref: string, input: RuntimeSessionControlInput = {}): Promise<RuntimeSessionFacts | RuntimeSessionUnavailable> {
    const record = this.records.get(runtime_session_ref);
    if (!record) return unavailableSession("session_missing", error("session_lost", "Runtime Session is missing.", true));
    const owner = input.control_owner;
    if (owner && record.facts.control_lock.owner !== owner && record.facts.control_lock.state === "held") return lockConflict(record, owner);
    if (input.holder_ref && record.facts.control_lock.state === "held" && record.facts.control_lock.holder_ref !== input.holder_ref) return lockConflict(record, owner ?? record.facts.control_owner);
    return (await this.closeSession(runtime_session_ref)) ?? unavailableSession("session_missing", error("session_lost", "Runtime Session is missing.", true));
  }

  async closeSession(runtime_session_ref: string): Promise<RuntimeSessionFacts | null> {
    const record = this.records.get(runtime_session_ref);
    if (!record) return null;
    if (record.closing) return record.closing;
    if (record.facts.lifecycle_state === "closed") {
      record.profile_ownership?.release();
      delete record.profile_ownership;
      return snapshot(record.facts);
    }
    const closing = this.finishCloseSession(record);
    record.closing = closing;
    try {
      return await closing;
    } finally {
      if (record.closing === closing) delete record.closing;
    }
  }

  private async finishCloseSession(record: RuntimeSessionRecord): Promise<RuntimeSessionFacts> {
    const runtimeSessionRef = record.facts.runtime_session_ref;
    this.diagnosticsCursorBindings.delete(runtimeSessionRef);
    const closingAt = new Date().toISOString();
    bumpControlGeneration(record);
    record.facts.lifecycle_state = "disconnected";
    record.facts.last_seen_at = closingAt;
    record.facts.control_owner = "none";
    record.facts.control_lock = {
      owner: "none",
      state: "released",
      holder_ref: null,
      updated_at: closingAt,
      conflict_error: null
    };
    try {
      await record.close?.();
    } catch (cause) {
      record.facts.lifecycle_state = "failed";
      record.facts.current_error = error("session_cleanup_failed", "Runtime Session cleanup failed.", true);
      record.facts.availability.cdp = "unavailable";
      record.facts.availability.driver = "unavailable";
      record.facts.availability.viewer = "unavailable";
      record.facts.availability.snapshot = "unavailable";
      this.viewerControls.markClosed(runtimeSessionRef, closingAt);
      this.launchOptions.on_session_closed?.(runtimeSessionRef);
      throw cause;
    }
    record.profile_ownership?.release();
    delete record.profile_ownership;
    const now = new Date().toISOString();
    record.facts.lifecycle_state = "closed";
    record.facts.closed_at = now;
    record.facts.last_seen_at = now;
    record.facts.availability.cdp = "unavailable";
    record.facts.availability.driver = "unavailable";
    record.facts.availability.viewer = "unavailable";
    record.facts.availability.snapshot = "unavailable";
    record.facts.control_owner = "none";
    record.facts.control_lock = {
      owner: "none",
      state: "closed",
      holder_ref: null,
      updated_at: now,
      conflict_error: null
    };
    record.user_held_session = false;
    record.read_operation_user_release_pending = false;
    record.read_operation_user_handoff = false;
    record.facts.current_page = { ...record.facts.current_page, status: "unavailable", observed_at: now };
    this.viewerControls.markClosed(runtimeSessionRef, now);
    this.launchOptions.on_session_closed?.(runtimeSessionRef);
    return snapshot(record.facts);
  }

  async closeAllSessions(): Promise<void> {
    const failures: unknown[] = [];
    for (const runtimeSessionRef of this.records.keys()) {
      if (this.records.get(runtimeSessionRef)?.facts.lifecycle_state === "closed") continue;
      try {
        await this.closeSession(runtimeSessionRef);
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length > 0) throw new AggregateError(failures, "Unable to close every Runtime Session.");
  }

  markSnapshotCaptured(runtime_session_ref: string, captured_at: string, evidence_refs: readonly string[]): void {
    const record = this.records.get(runtime_session_ref);
    if (!record) return;
    record.facts.last_seen_at = captured_at;
    record.facts.availability.snapshot = "available";
    record.facts.availability.evidence = "available";
    record.facts.facts.push(
      { key: "snapshot.capture", source: "observed", value: "available", evidence_ref: evidence_refs[0] },
      { key: "evidence.capture", source: "validation_evidence", value: "refs_available", evidence_ref: evidence_refs[1] }
    );
  }

  applyHandoff(runtime_session_ref: string, control: Pick<ControlOwnerFacts, "owner" | "previous_owner" | "handoff_reason" | "takeover" | "updated_at">): void {
    const record = this.records.get(runtime_session_ref);
    if (!record) return;
    record.facts.control_owner = control.owner;
    record.facts.last_seen_at = control.updated_at;
    record.facts.control_lock = {
      owner: control.owner,
      state: control.owner === "none" ? "released" : "held",
      holder_ref: control.owner === "user" ? "harbor_mediated_user" : control.owner === "none" ? null : control.owner,
      updated_at: control.updated_at,
      conflict_error: null
    };
    bumpControlGeneration(record);
    // Only the server-owned handoff path calls applyHandoff; create/lock input
    // must never be treated as proof that a user held this session.
    record.user_held_session = control.owner === "user" && isInteractiveUserViewer(record.facts);
    record.read_operation_user_release_pending = false;
    record.read_operation_user_handoff = record.read_operation_user_confirmed &&
      control.previous_owner === "user" &&
      control.owner === "core_task";
    record.facts.facts.push(
      { key: "control.owner", source: "observed", value: control.owner },
      { key: "handoff.reason", source: "observed", value: control.handoff_reason ?? "none" },
      { key: "takeover.available", source: "observed", value: String(control.takeover.available) }
    );
  }

  isTrustedUserHeldSession(runtime_session_ref: string): boolean {
    const record = this.records.get(runtime_session_ref);
    return !!record && record.user_held_session && isInteractiveUserViewer(record.facts);
  }

  isSupervisorConfirmableLocalProviderUserSession(runtime_session_ref: string): boolean {
    const record = this.records.get(runtime_session_ref);
    return !!record && hasHeldUserLock(record) && record.execution_surface === "local_provider";
  }

  markReadOperationUserConfirmed(runtime_session_ref: string): void {
    const record = this.records.get(runtime_session_ref);
    if (!record || (!this.isTrustedUserHeldSession(runtime_session_ref) && !this.isSupervisorConfirmableLocalProviderUserSession(runtime_session_ref))) return;
    record.user_held_session = true;
    record.read_operation_user_confirmed = true;
    record.read_operation_user_release_pending = false;
    record.read_operation_user_handoff = false;
  }

  markPersistedReadOperationEligible(runtime_session_ref: string): void {
    const record = this.records.get(runtime_session_ref);
    if (!record || record.execution_surface !== "local_provider" || record.facts.control_owner !== "core_task" ||
      record.facts.control_lock.owner !== "core_task" || record.facts.control_lock.state !== "held") return;
    record.read_operation_user_confirmed = true;
    record.read_operation_user_release_pending = false;
    record.read_operation_user_handoff = true;
  }

  async clearManagedPublicPageGuard(runtime_session_ref: string) {
    const record = this.records.get(runtime_session_ref);
    if (!record || record.facts.control_owner !== "user" || record.facts.control_lock.state !== "held" || record.active_provider_interactions) return managedUnavailable("control_lock_conflict");
    try {
      if (record.clearPublicPageGuard) await this.withProviderInteraction(record, record.clearPublicPageGuard);
      return { status: "completed" as const };
    } catch { return managedUnavailable("managed_public_guard_release_failed"); }
  }

  getManagedInteraction(operation_ref: string) {
    return this.interactionReceipts.get(operation_ref)?.result ?? null;
  }

  async operateManagedInteraction(runtime_session_ref: string, input: ManagedInteractionRequest) {
    const refused = (failure_class: string) => ({ status: "unavailable" as const, dispatch_state: "not_dispatched" as const,
      failure_class, operation_ref: input.operation_ref, runtime_session_ref, observed_at: new Date().toISOString() });
    const requestHash = createHash("sha256").update(JSON.stringify([runtime_session_ref, Object.entries(input).sort(([a], [b]) => a.localeCompare(b))])).digest("hex");
    const previous = this.interactionReceipts.get(input.operation_ref);
    if (previous) return previous.request_hash === requestHash ? previous.result : refused("managed_interaction_idempotency_conflict");
    const record = this.records.get(runtime_session_ref);
    if (!record) return refused("session_missing");
    const coreLeaseHeld = isCoreLeaseHeld(record, input.holder_ref);
    const releasedForSnapshot = input.action === "snapshot" && isReleasedControl(record);
    if (!coreLeaseHeld && !releasedForSnapshot) return refused("control_lock_conflict");
    if (record.active_provider_interactions || !["active", "locked", "idle"].includes(record.facts.lifecycle_state)) return refused("session_not_ready");
    const operation = record.interaction;
    if (record.execution_surface !== "local_provider" || !isTrustedManagedInteractionOperation(operation)) return refused("managed_interaction_provider_unavailable");
    const authorizedOrigins = input.authorized_origins === undefined
      ? [input.expected_origin]
      : [...new Set(input.authorized_origins)];
    // A direct internal caller may bypass the HTTP parser, but it must not be
    // allowed to turn an explicitly supplied Core intersection into a union.
    if (!authorizedOrigins.includes(input.expected_origin)) return refused("managed_interaction_origin_denied");
    const generation = record.control_generation;
    const relationFailure = await this.refreshPageRelation(record);
    if (relationFailure) return refused(relationFailure);
    if (record.control_generation !== generation) return refused("managed_interaction_control_changed");
    if (releasedForSnapshot ? !isReleasedControl(record) : !isCoreLeaseHeld(record, input.holder_ref)) {
      return refused(releasedForSnapshot ? "managed_interaction_control_changed" : "control_lock_conflict");
    }
    if (record.active_provider_interactions || !["active", "locked", "idle"].includes(record.facts.lifecycle_state)) return refused("session_not_ready");
    const observed = record.interaction_snapshot;
    let pageBinding: { facts: ManagedPageFacts; provider_page_ref: string } | undefined;
    if (record.page_registry) {
      try {
        if (input.page_ref) pageBinding = record.page_registry.binding({ page_ref: input.page_ref });
        else {
          const pages = record.page_registry.list(authorizedOrigins).pages;
          if (pages.length === 1) pageBinding = record.page_registry.binding({ page_id: pages[0]!.page_id });
          else if (pages.length > 1) return refused("page_selection_required");
        }
      } catch { return refused("managed_interaction_provider_unavailable"); }
      if (!pageBinding) return refused(input.page_ref ? "managed_interaction_observation_stale" : "page_selection_required");
      if (pageBinding.facts.origin !== input.expected_origin || !authorizedOrigins.includes(pageBinding.facts.origin)) return refused("managed_interaction_origin_denied");
    }
    if (input.action !== "snapshot" && (!observed || observed.control_generation !== generation || observed.holder_ref !== input.holder_ref ||
      observed.page_ref !== input.page_ref || observed.observation_ref !== input.observation_ref)) return refused("managed_interaction_observation_stale");
    // Retain receipts until Runtime exit: eviction would allow a duplicate input.
    const receipt = { request_hash: requestHash, result: { status: "unknown_outcome" as const, dispatch_state: "dispatched" as const,
      failure_class: "managed_interaction_in_progress", operation_ref: input.operation_ref, runtime_session_ref, observed_at: new Date().toISOString() } as ManagedInteractionResult & { operation_ref: string; runtime_session_ref: string; observed_at: string } };
    this.interactionReceipts.set(input.operation_ref, receipt);
    const { holder_ref: _holder, operation_ref: _operation, controlled_origin: _controlled, ...action } = input;
    const providerAction = pageBinding ? {
      ...action,
      authorized_origins: authorizedOrigins,
      provider_page_ref: pageBinding.provider_page_ref,
      ...(input.action === "snapshot" ? {} : { page_ref: observed?.provider_snapshot_ref ?? action.page_ref })
    } : { ...action, authorized_origins: authorizedOrigins };
    try {
      const result = await this.withProviderInteraction(record, () => operation({ ...providerAction, control_generation: generation }));
      const controlUnchanged = releasedForSnapshot
        ? isReleasedControl(record)
        : isCoreLeaseHeld(record, input.holder_ref);
      if (record.control_generation !== generation || !controlUnchanged || !["active", "locked", "idle"].includes(record.facts.lifecycle_state)) {
        receipt.result = { ...receipt.result, failure_class: "managed_interaction_control_changed" };
      } else {
        let projected = result;
        if (pageBinding) {
          const current = record.page_registry!.binding({ page_id: pageBinding.facts.page_id });
          if (!current || current.facts.page_ref !== pageBinding.facts.page_ref) {
            receipt.result = { ...receipt.result, status: result.dispatch_state === "dispatched" ? "unknown_outcome" : "unavailable", dispatch_state: result.dispatch_state, failure_class: "stale_document" };
            return receipt.result;
          }
          projected = {
            ...result,
            ...(result.page ? { page: { ...result.page, ...current.facts } } : {}),
            ...(result.snapshot ? { snapshot: { ...result.snapshot, page_ref: current.facts.page_ref } } : {})
          };
          if (result.page?.current_url && new URL(result.page.current_url).origin === input.expected_origin) this.applyPageFacts(record, result.page.current_url, { ...result.page, page_ref: current.facts.page_ref, page_id: current.facts.page_id, document_generation: current.facts.document_generation });
        } else if (result.page?.current_url && new URL(result.page.current_url).origin === input.expected_origin) this.applyPageFacts(record, result.page.current_url, result.page);
        receipt.result = { ...projected, operation_ref: input.operation_ref, runtime_session_ref, observed_at: new Date().toISOString() };
        if (result.status === "completed" && result.snapshot) record.interaction_snapshot = {
          page_ref: pageBinding?.facts.page_ref ?? result.snapshot.page_ref,
          ...(pageBinding ? { provider_snapshot_ref: result.snapshot.page_ref } : {}),
          observation_ref: result.snapshot.observation_ref, control_generation: generation, holder_ref: input.holder_ref
        };
        else delete record.interaction_snapshot;
      }
    } catch {
      receipt.result = { ...receipt.result, failure_class: "managed_interaction_outcome_unknown" };
      delete record.interaction_snapshot;
    }
    return receipt.result;
  }

  async operateManagedPublicPage(runtime_session_ref: string, holder_ref: string, input: ManagedPublicPageInput) {
    const record = this.records.get(runtime_session_ref);
    if (!record || !boundedManagedRef(holder_ref)) return managedUnavailable("session_missing");
    const releasedForRead = input.url === undefined && isReleasedControl(record);
    if (!isCoreLeaseHeld(record, holder_ref) && !releasedForRead) return managedUnavailable("control_lock_conflict");
    if (record.active_provider_interactions || !["active", "locked", "idle"].includes(record.facts.lifecycle_state)) return managedUnavailable("session_not_ready");
    const operation = record.publicPage;
    if (record.execution_surface !== "local_provider" || !isTrustedManagedPublicPageOperation(operation)) return managedUnavailable("managed_public_page_unavailable");
    const generation = record.control_generation;
    const relationFailure = await this.refreshPageRelation(record);
    if (relationFailure) return managedUnavailable(relationFailure);
    if (record.control_generation !== generation) return managedUnavailable("control_changed");
    if (releasedForRead ? !isReleasedControl(record) : !isCoreLeaseHeld(record, holder_ref)) {
      return managedUnavailable(releasedForRead ? "control_changed" : "control_lock_conflict");
    }
    if (record.active_provider_interactions || !["active", "locked", "idle"].includes(record.facts.lifecycle_state)) return managedUnavailable("session_not_ready");
    const pageBinding = this.resolveLegacyPageBinding(record, input, input.expected_origin, "managed_public_origin_denied");
    if (pageBinding.failure) return managedUnavailable(pageBinding.failure);
    const providerInput = pageBinding.binding
      ? { ...input, provider_page_ref: pageBinding.binding.provider_page_ref }
      : input;
    try {
      const result = await this.withProviderInteraction(record, () => operation(providerInput));
      const controlUnchanged = releasedForRead
        ? isReleasedControl(record)
        : isCoreLeaseHeld(record, holder_ref);
      if (record.control_generation !== generation || !controlUnchanged || !["active", "locked", "idle"].includes(record.facts.lifecycle_state)) return managedUnavailable("control_changed");
      let resultPage = result.page;
      if (resultPage && pageBinding.binding) {
        const current = record.page_registry?.updateProviderPage(pageBinding.binding.provider_page_ref, resultPage) ?? pageBinding.binding;
        resultPage = { ...resultPage, page_id: current.facts.page_id, page_ref: current.facts.page_ref, document_generation: current.facts.document_generation, origin: current.facts.origin, active: current.facts.active };
      }
      if (result.status !== "completed") {
        if (resultPage?.current_url) this.applyPageFacts(record, resultPage.current_url, resultPage);
        return managedUnavailable(result.failure_class);
      }
      if (!resultPage?.current_url || new URL(resultPage.current_url).origin !== input.expected_origin) return managedUnavailable("managed_public_origin_denied");
      this.applyPageFacts(record, resultPage.current_url, resultPage);
      return { status: "completed" as const, session: snapshot(record.facts), observed_at: new Date().toISOString(),
        ...(result.text === undefined ? {} : { text: result.text, truncated: result.truncated }) };
    } catch { return managedUnavailable("managed_public_page_unavailable"); }
  }

  async observeManagedSession(runtime_session_ref: string, input: ManagedObservationInput | string): Promise<ManagedObservation | ManagedObservationUnavailable> {
    const holder_ref = typeof input === "string" ? input : input.holder_ref;
    const selector: ManagedPageSelector = typeof input === "string" ? {} : input;
    const expectedOrigin = typeof input === "string" ? undefined : input.expected_origin;
    const record = this.records.get(runtime_session_ref);
    if (!record || !boundedManagedRef(holder_ref)) return managedUnavailable("session_missing");
    const releasedForObservation = isReleasedControl(record);
    if (!isCoreLeaseHeld(record, holder_ref) && !releasedForObservation) return managedUnavailable("control_lock_conflict");
    if (record.active_provider_interactions || !["active", "locked", "idle"].includes(record.facts.lifecycle_state) || !record.facts.identity_environment_ref) return managedUnavailable("session_not_ready");
    const observe = record.observePage;
    if (record.execution_surface !== "local_provider" || !isTrustedManagedPageObserver(observe)) return managedUnavailable("managed_observation_unavailable");
    const generation = record.control_generation;
    const relationFailure = await this.refreshPageRelation(record);
    if (relationFailure) return managedUnavailable(relationFailure);
    if (record.control_generation !== generation) return managedUnavailable("control_changed");
    if (releasedForObservation ? !isReleasedControl(record) : !isCoreLeaseHeld(record, holder_ref)) {
      return managedUnavailable(releasedForObservation ? "control_changed" : "control_lock_conflict");
    }
    if (record.active_provider_interactions || !["active", "locked", "idle"].includes(record.facts.lifecycle_state)) return managedUnavailable("session_not_ready");
    const pageBinding = this.resolveLegacyPageBinding(record, selector, expectedOrigin, "managed_observation_unavailable");
    if (pageBinding.failure) return managedUnavailable(pageBinding.failure);
    const providerInput = pageBinding.binding ? { provider_page_ref: pageBinding.binding.provider_page_ref } : undefined;
    try {
      const observed = await this.withProviderInteraction(record, () => observe(providerInput));
      const controlUnchanged = releasedForObservation
        ? isReleasedControl(record)
        : isCoreLeaseHeld(record, holder_ref);
      if (record.control_generation !== generation || !controlUnchanged || record.active_provider_interactions || !["active", "locked", "idle"].includes(record.facts.lifecycle_state)) return managedUnavailable("control_changed");
      if (!observed.page.current_url) return managedUnavailable("page_not_ready");
      let observedPage = observed.page;
      if (pageBinding.binding) {
        const current = record.page_registry?.updateProviderPage(pageBinding.binding.provider_page_ref, observed.page) ?? pageBinding.binding;
        observedPage = { ...observed.page, page_id: current.facts.page_id, page_ref: current.facts.page_ref, document_generation: current.facts.document_generation, origin: current.facts.origin, active: current.facts.active };
        if (observed.provider_page_ref !== undefined && observed.provider_page_ref !== pageBinding.binding.provider_page_ref) return managedUnavailable("managed_observation_unavailable");
      }
      const observedUrl = observedPage.current_url;
      if (!observedUrl) return managedUnavailable("page_not_ready");
      this.applyPageFacts(record, observedUrl, observedPage);
      const result: ManagedObservation = { status: "completed", observation_ref: opaqueRef("observation"), observed_at: new Date().toISOString(),
        runtime_session_ref, identity_environment_ref: record.facts.identity_environment_ref, profile_ref: record.facts.profile_ref,
        control_owner: record.facts.control_owner, control_generation: generation,
        page: { current_url: observedPage.current_url, title: observedPage.title, status: observedPage.status, ...(observedPage.page_id ? { page_id: observedPage.page_id } : {}), ...(observedPage.page_ref ? { page_ref: observedPage.page_ref } : {}), ...(observedPage.document_generation ? { document_generation: observedPage.document_generation } : {}), ...(observedPage.origin !== undefined ? { origin: observedPage.origin } : {}), ...(observedPage.active !== undefined ? { active: observedPage.active } : {}) }, account: observed.account };
      record.managed_observations = [...(record.managed_observations ?? []).slice(-15), result];
      return snapshot(result);
    } catch { return managedUnavailable("managed_observation_unavailable"); }
  }

  async readRuntimeDiagnostics(runtime_session_ref: string, input: RuntimeDiagnosticsInput): Promise<RuntimeDiagnosticsResponse> {
    const record = this.records.get(runtime_session_ref);
    if (!record) return diagnosticsUnavailable("session_missing", "Runtime Session is missing.", true);
    if (!["active", "idle", "locked"].includes(record.facts.lifecycle_state)) return diagnosticsUnavailable("session_not_ready", "Runtime Session is not ready for observation.", true);
    const probe = record.readDiagnostics;
    if (record.execution_surface !== "local_provider" || !isTrustedRuntimeDiagnosticsProbe(probe)) return diagnosticsUnavailable("provider_unavailable");
    const relationFailure = await this.refreshPageRelation(record);
    if (relationFailure) return diagnosticsUnavailable(relationFailure === "page_relation_unavailable" ? relationFailure : "provider_unavailable", "The Provider Page relation is unavailable.", true);
    try {
      // Diagnostics are observation-only: this path intentionally does not acquire or change ControlLease.
      let providerInput = input;
      let binding: { facts: ManagedPageFacts; provider_page_ref: string } | undefined;
      if (record.page_registry) {
        const authorizedOrigins = new Set(input.authorized_origins ?? [input.origin]);
        if (input.page_ref) {
          binding = record.page_registry.binding({ page_ref: input.page_ref });
        } else {
          const pages = record.page_registry.list([...authorizedOrigins]).pages;
          if (pages.length === 1) binding = record.page_registry.binding({ page_id: pages[0]!.page_id });
          else if (pages.length > 1) return diagnosticsUnavailable("page_selection_required", "A Page reference is required when the Instance has multiple Pages.", false);
          else binding = record.page_registry.activeBinding();
        }
        if (!binding) return diagnosticsUnavailable(input.page_ref ? "stale_page" : "provider_unavailable", "The requested Page binding is stale.", true);
        if (!binding.facts.origin || !authorizedOrigins.has(binding.facts.origin)) return diagnosticsUnavailable("wrong_page", "The requested Page origin is not authorized.", false);
        if (input.document_generation !== undefined && input.document_generation !== binding.facts.document_generation) {
          return diagnosticsUnavailable("stale_document", "The requested document generation is stale.", true);
        }
        const cursorBindings = this.diagnosticsCursorBindings.get(runtime_session_ref) ?? new Map<string, string>();
        this.diagnosticsCursorBindings.set(runtime_session_ref, cursorBindings);
        const providerCursor = input.cursor === undefined ? undefined : cursorBindings.get(input.cursor);
        if (input.cursor !== undefined && !providerCursor) return diagnosticsUnavailable("cursor_stale", "The diagnostics cursor is stale or belongs to another Page.", true);
        const { page_ref: _publicPageRef, cursor: _publicCursor, authorized_origins: _authorizedOrigins, ...diagnostics } = input;
        providerInput = { ...diagnostics, provider_page_ref: binding.provider_page_ref, ...(providerCursor ? { cursor: providerCursor } : {}) };
      }
      const result = await this.withProviderInteraction(record, () => probe(providerInput));
      if (result.status !== "completed" || !binding) return result.status === "completed"
        ? { ...result, runtime_session_ref, profile_ref: record.facts.profile_ref }
        : result;
      await record.page_registry!.refresh();
      const currentBinding = record.page_registry!.binding({ page_id: binding.facts.page_id });
      if (!currentBinding || currentBinding.facts.page_ref !== binding.facts.page_ref) return diagnosticsUnavailable("stale_document", "The Page navigated while diagnostics were being read.", true);
      const cursorBindings = this.diagnosticsCursorBindings.get(runtime_session_ref)!;
      const publicCursor = opaqueRef("diagnostics_cursor");
      const publicNextCursor = opaqueRef("diagnostics_cursor");
      cursorBindings.set(publicCursor, result.cursor);
      cursorBindings.set(publicNextCursor, result.next_cursor);
      while (cursorBindings.size > 256) cursorBindings.delete(cursorBindings.keys().next().value!);
      return {
        ...result,
        runtime_session_ref,
        profile_ref: record.facts.profile_ref,
        page_ref: binding.facts.page_ref,
        document_generation: binding.facts.document_generation,
        cursor: publicCursor,
        next_cursor: publicNextCursor,
        network: result.network.map(event => ({ ...event, page_ref: binding!.facts.page_ref, document_generation: binding!.facts.document_generation })),
        console: result.console.map(event => ({ ...event, page_ref: binding!.facts.page_ref, document_generation: binding!.facts.document_generation }))
      };
    } catch {
      this.markDriverLost(record);
      return diagnosticsUnavailable("provider_unavailable", "Runtime Session driver was lost.", false);
    }
  }

  findManagedObservation(identity_environment_ref: string, observation_ref: string, holder_ref: string): ManagedObservation | null {
    for (const record of this.records.values()) {
      const observed = record.managed_observations?.find(item => item.observation_ref === observation_ref);
      if (!observed || observed.identity_environment_ref !== identity_environment_ref || observed.control_generation !== record.control_generation ||
        !["active", "locked", "idle"].includes(record.facts.lifecycle_state) || record.facts.control_owner !== "core_task" || record.facts.control_lock.state !== "held" ||
        record.facts.control_lock.holder_ref !== holder_ref || record.active_provider_interactions || Date.now() - Date.parse(observed.observed_at) > 30_000) continue;
      return snapshot(observed);
    }
    return null;
  }

  getValidationRuntimeFacts(runtime_session_ref: string): ValidationRuntimeFacts | null {
    const record = this.records.get(runtime_session_ref);
    if (!record) return null;
    return {
      schema_version: HARBOR_VALIDATION_RUNTIME_FACTS_SCHEMA,
      runtime_session_ref,
      provider_ref: record.facts.provider_ref,
      profile_ref: record.facts.profile_ref,
      validation_refs: record.facts.facts.flatMap((fact) => fact.evidence_ref ? [fact.evidence_ref] : []),
      runtime_ready: record.facts.lifecycle_state === "active" || record.facts.lifecycle_state === "idle",
      blocking_reasons: record.facts.current_error ? [record.facts.current_error] : [],
      availability: snapshot(record.facts.availability),
      unavailable: null
    };
  }

  isReadable(runtime_session_ref: string): boolean {
    const session = this.records.get(runtime_session_ref)?.facts;
    return session ? isRuntimeSessionReadable(session) : false;
  }

  private async withProviderInteraction<T>(record: RuntimeSessionRecord, operation: () => Promise<T>): Promise<T> {
    record.active_provider_interactions += 1;
    try {
      return await operation();
    } finally {
      record.active_provider_interactions -= 1;
    }
  }

  private async withPageRelation<T>(
    record: RuntimeSessionRecord,
    operation: () => Promise<T>
  ): Promise<{ relationFailure: "page_relation_unavailable" | "provider_unavailable" } | { result: T }> {
    return this.withProviderInteraction(record, async () => {
      const relationFailure = await this.refreshPageRelation(record);
      if (relationFailure) return { relationFailure };
      return { result: await operation() };
    });
  }

  /** Refresh the Provider Page relation before any operation that consumes it. */
  private async refreshPageRelation(record: RuntimeSessionRecord): Promise<"page_relation_unavailable" | "provider_unavailable" | null> {
    if (!record.page_registry) return "page_relation_unavailable";
    try {
      await record.page_registry.refresh();
      return null;
    } catch (cause) {
      return pageNavigationFailureClass(cause) === "provider_unavailable" ? "provider_unavailable" : "page_relation_unavailable";
    }
  }

  private resolveLegacyPageBinding(
    record: RuntimeSessionRecord,
    selector: ManagedPageSelector,
    expectedOrigin: string | undefined,
    emptyFailure: string
  ): { binding?: { facts: ManagedPageFacts; provider_page_ref: string }; failure?: string } {
    const hasSelector = selector.page_id !== undefined || selector.page_ref !== undefined;
    if (!record.page_registry) return hasSelector ? { failure: "stale_page" } : {};
    if (hasSelector) {
      if ((selector.page_id !== undefined && !boundedManagedRef(selector.page_id)) ||
        (selector.page_ref !== undefined && !boundedManagedRef(selector.page_ref)) ||
        (selector.document_generation !== undefined && (!Number.isSafeInteger(selector.document_generation) || selector.document_generation < 1))) {
        return { failure: "stale_page" };
      }
      const binding = record.page_registry.binding({ page_id: selector.page_id, page_ref: selector.page_ref });
      if (!binding) return { failure: "stale_page" };
      if (expectedOrigin !== undefined && binding.facts.origin !== expectedOrigin) return { failure: "managed_public_origin_denied" };
      if (selector.document_generation !== undefined && binding.facts.document_generation !== selector.document_generation) return { failure: "stale_document" };
      return { binding };
    }
    // Ambiguity is about the Instance's Page relation, not only the subset
    // that happens to match the requested origin.  Filtering first would
    // silently choose an authorized Page while hiding another live Page and
    // would make the legacy route depend on authorization ordering.
    const candidates = record.page_registry.legacyBindings();
    if (candidates.length > 1) return { failure: "page_selection_required" };
    if (candidates.length === 0) return { failure: emptyFailure };
    const binding = candidates[0]!;
    if (expectedOrigin !== undefined && binding.facts.origin !== expectedOrigin) return { failure: emptyFailure };
    if (selector.document_generation !== undefined && selector.document_generation !== binding.facts.document_generation) return { failure: "stale_document" };
    return { binding };
  }

  async probeReadOperation(
    runtime_session_ref: string,
    input: LocalProviderReadProbeInput
  ): Promise<LocalProviderReadProbeResult> {
    const record = this.records.get(runtime_session_ref);
    if (!record) {
      return {
        status: "unavailable",
        failure_class: "provider_probe_unavailable",
        message: "Runtime Session is missing.",
        retryable: true
      };
    }
    if (record.execution_surface === "fixture") {
      return {
        status: "unavailable",
        failure_class: "fixture_runtime",
        message: "Fixture launchers cannot execute allowlisted read operations.",
        retryable: false
      };
    }
    const probeReadOperation = record.probeReadOperation;
    if (record.execution_surface !== "local_provider" || !isTrustedLocalProviderReadProbe(probeReadOperation)) {
      return {
        status: "unavailable",
        failure_class: "evidence_refs_missing",
        message: "The managed local provider does not expose a trusted read-only probe adapter.",
        retryable: false
      };
    }
    try {
      const outcome = await this.withPageRelation(record, () => probeReadOperation(input));
      if ("relationFailure" in outcome) {
        return {
          status: "unavailable",
          failure_class: outcome.relationFailure === "page_relation_unavailable" ? outcome.relationFailure : "provider_probe_unavailable",
          message: "The Provider Page relation is unavailable.",
          retryable: true
        };
      }
      const result = outcome.result;
      if (result.page) this.applyPageFacts(record, result.page.current_url ?? input.target_url, result.page);
      return result;
    } catch {
      this.markDriverLost(record);
      return { status: "unavailable", failure_class: "provider_probe_unavailable", message: "Runtime Session driver was lost. Close the session before reopening.", retryable: false };
    }
  }

  async probeSiteResource(
    runtime_session_ref: string,
    input: LocalProviderSiteResourceProbeInput
  ): Promise<LocalProviderSiteResourceProbeResult> {
    const record = this.records.get(runtime_session_ref);
    const probe = record?.probeSiteResource;
    if (!record || record.execution_surface !== "local_provider" || !isTrustedLocalProviderSiteResourceProbe(probe)) {
      return {
        status: "unknown",
        failure_class: "provider_probe_unavailable",
        message: "The managed local provider does not expose a trusted site-resource probe.",
        verified_fact_keys: []
      };
    }
    try {
      const outcome = await this.withPageRelation(record, () => probe(input));
      if ("relationFailure" in outcome) {
        return {
          status: "unknown",
          failure_class: outcome.relationFailure === "page_relation_unavailable" ? outcome.relationFailure : "provider_probe_unavailable",
          message: "The Provider Page relation is unavailable.",
          verified_fact_keys: []
        };
      }
      return outcome.result;
    } catch {
      this.markDriverLost(record);
      return {
        status: "unknown",
        failure_class: "provider_probe_unavailable",
        message: "The trusted site-resource probe failed before it could return a structured result.",
        verified_fact_keys: []
      };
    }
  }

  async probeWritePrecheck(
    runtime_session_ref: string,
    input: LocalProviderWritePrecheckProbeInput
  ): Promise<LocalProviderWritePrecheckProbeResult> {
    const record = this.records.get(runtime_session_ref);
    const probe = record?.probeWritePrecheck;
    if (!record) {
      return {
        status: "unavailable",
        failure_class: "provider_probe_unavailable",
        message: "Runtime Session is missing.",
        retryable: true
      };
    }
    if (record.execution_surface === "fixture") {
      return {
        status: "unavailable",
        failure_class: "fixture_runtime",
        message: "Fixture launchers cannot validate a real write-precheck page.",
        retryable: false
      };
    }
    if (record.execution_surface !== "local_provider" || !isTrustedLocalProviderWritePrecheckProbe(probe)) {
      return {
        status: "unavailable",
        failure_class: "provider_probe_unavailable",
        message: "The managed local provider has no trusted write-precheck probe.",
        retryable: false
      };
    }
    try {
      const result = await this.withProviderInteraction(record, () => probe(input));
      if (result.page) this.applyPageFacts(record, input.target_url, result.page);
      return result;
    } catch {
      this.markDriverLost(record);
      return { status: "unavailable", failure_class: "provider_probe_unavailable", message: "Runtime Session driver was lost. Close the session before reopening.", retryable: false };
    }
  }

  async executeMediaAction(
    runtime_session_ref: string,
    input: LocalProviderMediaActionInput
  ): Promise<LocalProviderMediaActionResult> {
    const record = this.records.get(runtime_session_ref);
    if (!record) {
      return {
        status: "unavailable",
        failure_class: "session_missing",
        message: "Runtime Session is missing.",
        retryable: true,
        submitted: false
      };
    }
    if (record.execution_surface === "fixture") {
      return {
        status: "unavailable",
        failure_class: "fixture_runtime",
        message: "Fixture launchers cannot execute media actions.",
        retryable: false,
        submitted: false
      };
    }
    const probe = record.executeMediaAction;
    if (record.execution_surface !== "local_provider" || !isTrustedLocalProviderMediaActionProbe(probe)) {
      return {
        status: "unavailable",
        failure_class: "provider_probe_unavailable",
        message: "The managed local provider has no trusted media-action adapter.",
        retryable: false,
        submitted: false
      };
    }
    try {
      const result = await this.withProviderInteraction(record, () => probe(input));
      if (result.page) this.applyPageFacts(record, input.target_url, result.page);
      return result;
    } catch {
      this.markDriverLost(record);
      return {
        status: "unavailable",
        failure_class: "operation_result_unknown",
        message: "The media action outcome could not be determined.",
        retryable: false,
        operation_ref: opaqueRef("media_operation"),
        submitted: false
      };
    }
  }

  private findIdentitySession(
    profile_ref: string,
    identity_environment_ref: string,
    execution_identity_ref: string
  ): RuntimeSessionRecord | null {
    for (const record of this.records.values()) {
      if (
        record.facts.profile_ref === profile_ref &&
        record.facts.identity_environment_ref === identity_environment_ref &&
        record.facts.execution_identity_ref === execution_identity_ref &&
        record.facts.lifecycle_state !== "closed" &&
        (record.facts.lifecycle_state !== "failed" || record.facts.current_error?.code === "session_cleanup_failed") &&
        record.facts.lifecycle_state !== "expired"
      ) {
        return record;
      }
    }
    return null;
  }

  private acquireControl(record: RuntimeSessionRecord, owner: ControlOwner, holder_ref: string): RuntimeSessionUnavailable | null {
    if (record.active_provider_interactions > 0) return unavailableSession("session_locked", error("session_locked", "Provider interaction is still in progress.", true));
    if (
      record.facts.lifecycle_state !== "active" &&
      record.facts.lifecycle_state !== "idle" &&
      record.facts.lifecycle_state !== "locked"
    ) return unavailableSession("session_cleanup_failed", error("session_cleanup_failed", "Runtime Session is not reusable.", true));
    if (hasControlConflict(record, owner, holder_ref)) return lockConflict(record, owner);
    if (record.read_operation_user_release_pending && owner !== "core_task") return lockConflict(record, owner);
    const preserveReleasedSnapshotGeneration = canPreserveReleasedSnapshotGeneration(record, owner, holder_ref);
    const preserveReadOperationHandoff = record.read_operation_user_handoff &&
      record.facts.control_owner === "core_task" && owner === "core_task" &&
      record.facts.control_lock.state === "held" && record.facts.control_lock.holder_ref === holder_ref;
    const now = new Date().toISOString();
    record.facts.lifecycle_state = "active";
    record.facts.last_seen_at = now;
    record.facts.control_owner = owner;
    record.facts.control_lock = {
      owner,
      state: "held",
      holder_ref,
      updated_at: now,
      conflict_error: null
    };
    if (!preserveReleasedSnapshotGeneration) bumpControlGeneration(record);
    record.user_held_session = false;
    record.read_operation_user_handoff = preserveReadOperationHandoff ||
      record.read_operation_user_release_pending && owner === "core_task";
    record.read_operation_user_release_pending = false;
    this.viewerControls.recordHandoff(record.facts.runtime_session_ref, { control_owner: owner });
    record.facts.facts.push(
      { key: "session.reuse", source: "observed", value: "same_profile_session" },
      { key: "control.owner", source: "observed", value: owner },
      { key: "control.lock_state", source: "observed", value: "held" }
    );
    return null;
  }

  private markDriverLost(record: RuntimeSessionRecord): void {
    const now = new Date().toISOString();
    this.diagnosticsCursorBindings.delete(record.facts.runtime_session_ref);
    bumpControlGeneration(record);
    record.page_registry?.invalidateRelation();
    // Keep ownership until explicit close proves that provider resources are gone.
    record.facts.lifecycle_state = "disconnected";
    record.facts.last_seen_at = now;
    record.facts.current_error = error("session_lost", "Runtime Session driver was lost. Close the session before reopening.", false);
    record.facts.availability = { ...record.facts.availability, cdp: "unavailable", driver: "unavailable", viewer: "unavailable", snapshot: "unavailable" };
    record.facts.control_owner = "none";
    record.facts.control_lock = { owner: "none", state: "released", holder_ref: null, updated_at: now, conflict_error: null };
    delete record.openUrl;
    delete record.publicPage;
    delete record.interaction;
    delete record.interaction_snapshot;
    delete record.clearPublicPageGuard;
    delete record.observePage;
    delete record.readDiagnostics;
    delete record.managed_observations;
    delete record.probeReadOperation;
    delete record.probeSiteResource;
    delete record.probeWritePrecheck;
    delete record.executeMediaAction;
    delete record.captureScreenshot;
    this.viewerControls.markClosed(record.facts.runtime_session_ref, now);
  }

  private applyPageFacts(record: RuntimeSessionRecord, requested_url: string, page: LocalProviderPageFacts): void {
    if (record.facts.current_error?.code === "session_lost") return;
    const now = new Date().toISOString();
    record.facts.current_page = pageFacts(requested_url, page, now);
    record.facts.last_seen_at = now;
    record.facts.current_error = page.error ?? null;
    if (page.error?.code === "session_lost") this.markDriverLost(record);
    else if (page.error) record.facts.lifecycle_state = "failed";
    record.facts.facts.push(
      ...page.facts,
      { key: "page.requested_url", source: "configured", value: requested_url },
      { key: "page.current_url", source: "observed", value: record.facts.current_page.current_url ?? "unavailable" },
      { key: "page.title", source: "observed", value: record.facts.current_page.title ?? "unavailable" },
      { key: "page.status", source: "observed", value: record.facts.current_page.status }
    );
  }
}

function unavailableSession(failure_class: RuntimeSessionUnavailable["failure_class"], current_error: RuntimeErrorFact): RuntimeSessionUnavailable {
  return {
    status: "unavailable",
    failure_class,
    message: current_error.message,
    retryable: current_error.retryable,
    current_error
  };
}

function error(code: RuntimeErrorCode, message: string, retryable = true): RuntimeErrorFact {
  return { code, message, retryable };
}

function lockConflict(record: RuntimeSessionRecord, requestedOwner: ControlOwner): RuntimeSessionUnavailable {
  const current_error = error(
    "session_locked",
    `Runtime Session is controlled by ${record.facts.control_lock.owner}; ${requestedOwner} cannot take it without release.`,
    true
  );
  // A rejected control request is not a driver or page health failure.
  record.facts.control_lock.conflict_error = current_error;
  return unavailableSession("session_locked", current_error);
}

function hasControlConflict(record: RuntimeSessionRecord, owner: ControlOwner, holder_ref: string): boolean {
  return record.facts.control_lock.state === "held" &&
    (record.facts.control_lock.owner !== owner || record.facts.control_lock.holder_ref !== holder_ref);
}

function isReleasedControl(record: RuntimeSessionRecord): boolean {
  const lock = record.facts.control_lock;
  return record.facts.control_owner === "none" && lock.owner === "none" && lock.state === "released" && lock.holder_ref === null;
}

function isCoreLeaseHeld(record: RuntimeSessionRecord, holder_ref: string): boolean {
  const lock = record.facts.control_lock;
  return record.facts.control_owner === "core_task" && lock.owner === "core_task" && lock.state === "held" && lock.holder_ref === holder_ref;
}

function canPreserveReleasedSnapshotGeneration(record: RuntimeSessionRecord, owner: ControlOwner, holder_ref: string): boolean {
  const observation = record.interaction_snapshot;
  return owner === "core_task" && isReleasedControl(record) && observation?.holder_ref === holder_ref && observation.control_generation === record.control_generation;
}

function retainsRuntimeResources(record: RuntimeSessionRecord): boolean {
  return record.facts.lifecycle_state !== "closed" &&
    record.facts.lifecycle_state !== "expired" &&
    (record.facts.lifecycle_state !== "failed" || record.facts.current_error?.code === "session_cleanup_failed");
}

function cleanupFailed(): RuntimeSessionUnavailable {
  return unavailableSession(
    "session_cleanup_failed",
    error("session_cleanup_failed", "The incompatible Runtime Session could not be closed safely.", true)
  );
}

function validateRuntimeUrl(url: string): RuntimeErrorFact | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "http:" || parsed.protocol === "https:" || parsed.protocol === "about:") return null;
  } catch {
    return error("url_unreachable", `URL is invalid and cannot be opened: ${url}`, false);
  }
  return error("url_unreachable", `URL scheme is unsupported for browser launch: ${url}`, false);
}

function isLocalIdentityEnvironmentFacts(value: LocalIdentityEnvironmentInput | LocalIdentityEnvironmentFacts): value is LocalIdentityEnvironmentFacts {
  return "schema_version" in value && value.schema_version === HARBOR_LOCAL_IDENTITY_ENVIRONMENT_SCHEMA;
}

function identityEnvironmentUnavailable(identityEnvironment: LocalIdentityEnvironmentFacts): RuntimeErrorFact | null {
  if (!identityEnvironment.profile_ref) return error("identity_environment_unavailable", "Identity environment has no profile_ref.", false);
  return null;
}

function pageFacts(requested_url: string, page: LocalProviderPageFacts, observed_at: string): RuntimePageFacts {
  return {
    requested_url,
    current_url: page.current_url,
    title: page.title,
    status: page.status,
    error_reason: page.error ?? null,
    observed_at,
    ...(page.page_id ? { page_id: page.page_id } : {}),
    ...(page.page_ref ? { page_ref: page.page_ref } : {}),
    ...(page.document_generation ? { document_generation: page.document_generation } : {}),
    ...(page.origin !== undefined ? { origin: page.origin } : {}),
    ...(page.active !== undefined ? { active: page.active } : {}),
    ...(page.opener_page_id ? { opener_page_id: page.opener_page_id } : {})
  };
}

function viewerAvailabilityState(availability: RuntimeViewerEntry["availability"]): RuntimeSessionFacts["availability"]["viewer"] {
  if (availability === "available") return "available";
  if (availability === "permission_denied") return "policy_denied";
  return availability === "unsupported" ? "unsupported" : "unavailable";
}

function isInteractiveUserViewer(facts: RuntimeSessionFacts): boolean {
  return facts.viewer_entry?.availability === "available" &&
    facts.viewer_entry.access_mode === "interactive" &&
    facts.viewer_entry.input_capabilities.includes("keyboard_mouse");
}

function hasHeldUserLock(record: RuntimeSessionRecord): boolean {
  return record.facts.control_owner === "user" &&
    record.facts.control_lock.owner === "user" &&
    record.facts.control_lock.state === "held";
}

function unavailablePage(requested_url: string, current_error: RuntimeErrorFact, observed_at: string): RuntimePageFacts {
  return {
    requested_url,
    current_url: null,
    title: null,
    status: "unavailable",
    error_reason: current_error,
    observed_at
  };
}

function pageUnavailable(
  failure_class: import("./page-navigation.js").ManagedPageUnavailableClass,
  runtime_session_ref: string,
  retryable: boolean,
  operation_ref?: string,
  dispatch_state: "not_dispatched" | "dispatched" = "not_dispatched"
): ManagedPageUnavailable {
  return {
    status: "unavailable",
    schema_version: "harbor-page-navigation/v1",
    failure_class,
    message: failure_class.replaceAll("_", " ").slice(0, 256),
    retryable,
    dispatch_state,
    runtime_session_ref,
    ...(operation_ref ? { operation_ref } : {})
  };
}

function pageFailureClass(error: unknown): import("./page-navigation.js").ManagedPageUnavailableClass {
  return pageNavigationFailureClass(error);
}

function bumpControlGeneration(record: RuntimeSessionRecord): void {
  record.control_generation += 1;
  record.page_registry?.invalidatePageBindings();
}

function snapshot<T>(value: T): T {
  return structuredClone(value);
}
