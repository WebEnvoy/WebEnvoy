import { createIdentityConsistencyFacts, type IdentityConsistencyFacts, type IdentityConsistencyFactsInput } from "./identity-consistency.js";
import { createLocalIdentityEnvironmentFacts, type LocalIdentityEnvironmentFacts, type LocalIdentityEnvironmentInput } from "./identity-environment.js";
import {
  HARBOR_LOCAL_IDENTITY_ENVIRONMENT_STORE_SCHEMA,
  LocalIdentityEnvironmentManager,
  type LocalIdentityEnvironmentManagerOptions,
  type LocalIdentityEnvironmentPublicRecord,
  type LocalIdentityEnvironmentStateUpdate,
  type ManagedLocalIdentityEnvironmentInput
} from "./identity-environment-manager.js";
import type { IdentityEnvironmentMutationRequest, IdentityEnvironmentMutationResult, MaterializedIdentityEnvironmentMutationRequest } from "./identity-environment-mutation-types.js";
import { materializeIdentityEnvironmentMutation } from "./identity-environment-mutations.js";
import {
  HARBOR_EVIDENCE_STATUS_FIXTURE_SCHEMA,
  HARBOR_PAGE_SCENE_REFS_SCHEMA,
  PageSceneStore,
  type CaptureSnapshotInput,
  type CoreSceneReference,
  type EvidenceRecord,
  type EvidenceFreshnessState,
  type EvidenceStatusDisplayState,
  type EvidenceStatusFixture,
  type PageSceneUnavailable,
  type RefMapRecord,
  type ScreenshotArtifactInput,
  type SnapshotCaptureResult,
  type SnapshotRecord
} from "./page-scene.js";
import {
  bindIdentityEnvironmentDefaultProvider,
  detectBrowserProviders,
  diagnoseBrowserProviderFailure,
  getDefaultBrowserProviderExecutable,
  HARBOR_BROWSER_PROVIDER_STATUS_SCHEMA,
  HARBOR_IDENTITY_PROVIDER_BINDING_SCHEMA,
  type BrowserProviderCatalog,
  type BrowserProviderDetectionInput,
  type IdentityEnvironmentProviderBinding,
  type IdentityEnvironmentProviderBindingInput
} from "./provider-management.js";
import { opaqueRef } from "./refs.js";
import { withProfileBackedLocalMaterial } from "./profile-backed-local-material.js";
import { profileStorageHasExternalLock, profileStoragePathExists } from "./profile-storage.js";
import {
  consumeManualAuthenticationAuthorizationGrant,
  type ManualAuthenticationAuthorizationGrant
} from "./manual-authentication-authorization.js";
import { createFixtureLauncher, launchLocalDedicatedProvider } from "./local-provider-launcher.js";
import {
  admitAllowlistedReadOperation,
  ReadOperationObservationStore,
  readOperationUnavailable,
  type AdmittedReadOperation,
  type CompletedReadOperation,
  type ReadOperationFailureClass,
  type ReadOperationObservationRecord,
  type ReadOperationUnavailable
} from "./read-operation.js";
import {
  createSiteResourceFacts,
  missingSiteRuntimeSession,
  siteResourceElements,
  type SiteResourceFacts,
  type SiteResourceFactsInput,
  type SiteResourceFactsUnavailable
} from "./site-runtime-facts.js";
import {
  HARBOR_PREVIEW_EVIDENCE_STATUS_FIXTURE_SCHEMA, HARBOR_REDACTED_PREVIEW_EXPORT_FIXTURE_SCHEMA, HARBOR_WRITE_PRECHECK_FACTS_SCHEMA,
  type PreviewEvidenceInput, type PreviewEvidenceState, type PreviewEvidenceStatusFixture, type RedactedPreviewExportFixture, type WritePrecheckFacts,
  type WritePrecheckInput
} from "./runtime-fixtures.js";
import {
  HARBOR_RUNTIME_FACTS_SCHEMA,
  HARBOR_VALIDATION_RUNTIME_FACTS_SCHEMA,
  RuntimeSessionStore,
  type CreateRuntimeSessionInput,
  type LocalProviderLauncher,
  type OpenIdentityEnvironmentSessionInput,
  type RuntimeSessionControlInput,
  type RuntimeSessionFacts,
  type RuntimeSessionRecord,
  type RuntimeSessionUnavailable,
  type ValidationRuntimeFacts
} from "./runtime-session.js";
import { isRuntimeSessionReadable } from "./runtime-session-types.js";
import {
  appRuntimeStatusFixture,
  coreRuntimeFacts,
  HARBOR_APP_RUNTIME_STATUS_FIXTURE_SCHEMA,
  HARBOR_CORE_RUNTIME_FACTS_SCHEMA,
  HARBOR_VIEWER_CONTROL_FACTS_SCHEMA,
  ViewerControlStore,
  type AppRuntimeStatusFixture,
  type CoreRuntimeFacts,
  type ControlOwner,
  type RecordHandoffInput,
  type ViewerControlFacts,
  type ViewerControlUnavailable
} from "./viewer-control.js";
import { DetailReadTargetStore, type DetailReadTargetRecord } from "./detail-read-target.js";
import {
  ManagedProviderLifecycle,
  type ManagedProviderLifecycleCommandResult,
  type ManagedProviderLifecycleOptions,
  type ManagedProviderLifecycleStatus,
  type ManagedProviderOperationInput
} from "./managed-provider-lifecycle.js";

export const DEFAULT_IDENTITY_SITE_URLS = {
  xiaohongshu: "https://www.xiaohongshu.com/explore",
  boss: "https://www.zhipin.com/"
} as const;

export { HARBOR_EVIDENCE_STATUS_FIXTURE_SCHEMA, HARBOR_PAGE_SCENE_REFS_SCHEMA } from "./page-scene.js";
export { createIdentityConsistencyFacts, HARBOR_IDENTITY_CONSISTENCY_FACTS_SCHEMA } from "./identity-consistency.js";
export { createLocalIdentityEnvironmentFacts, HARBOR_LOCAL_IDENTITY_ENVIRONMENT_SCHEMA } from "./identity-environment.js";
export { HARBOR_LOCAL_IDENTITY_ENVIRONMENT_STORE_SCHEMA, LocalIdentityEnvironmentManager } from "./identity-environment-manager.js";
export { HARBOR_IDENTITY_ENVIRONMENT_MUTATION_SCHEMA } from "./identity-environment-mutation-types.js";
export { HARBOR_MANAGED_PROVIDER_LIFECYCLE_SCHEMA, ManagedProviderLifecycle } from "./managed-provider-lifecycle.js";
export {
  bindIdentityEnvironmentDefaultProvider,
  detectBrowserProviders,
  diagnoseBrowserProviderFailure,
  getDefaultBrowserProviderExecutable,
  HARBOR_BROWSER_PROVIDER_STATUS_SCHEMA,
  HARBOR_IDENTITY_PROVIDER_BINDING_SCHEMA
} from "./provider-management.js";
export { createFixtureLauncher, launchLocalDedicatedProvider } from "./local-provider-launcher.js";
/** @deprecated Use `legacyReadOperation` only for the bounded pre-cutover adapter. */
export * as legacyReadOperation from "./read-operation.js";
/** @deprecated Use `legacySiteRuntimeFacts` only for the bounded pre-cutover adapter. */
export * as legacySiteRuntimeFacts from "./site-runtime-facts.js";
/** @deprecated Compatibility schema; new consumers must use the owner-clean runtime-facts route. */
export { HARBOR_ALLOWLISTED_READ_OPERATION_SCHEMA, LODE_262_ALLOWLIST_PIN, LODE_268_DETAIL_PIN } from "./read-operation.js";
/** @deprecated Compatibility schema; new consumers must use the owner-clean runtime-facts route. */
export { HARBOR_SITE_RESOURCE_FACTS_SCHEMA } from "./site-runtime-facts.js";
export { HARBOR_PREVIEW_EVIDENCE_STATUS_FIXTURE_SCHEMA, HARBOR_REDACTED_PREVIEW_EXPORT_FIXTURE_SCHEMA, HARBOR_WRITE_PRECHECK_FACTS_SCHEMA } from "./runtime-fixtures.js";
export { HARBOR_RUNTIME_FACTS_SCHEMA, HARBOR_VALIDATION_RUNTIME_FACTS_SCHEMA } from "./runtime-session.js";
export { HARBOR_APP_RUNTIME_STATUS_FIXTURE_SCHEMA, HARBOR_CORE_RUNTIME_FACTS_SCHEMA, HARBOR_VIEWER_CONTROL_FACTS_SCHEMA } from "./viewer-control.js";
export type {
  CaptureFailureClass,
  CaptureMethod,
  CaptureSnapshotInput,
  CoreSceneReference,
  EvidenceAccessState,
  EvidenceCapturePolicy,
  EvidenceRecord,
  EvidenceFreshnessState,
  EvidenceStatusDisplayState,
  EvidenceStatusEntry,
  EvidenceStatusFixture,
  EvidenceType,
  PageSceneUnavailable,
  RedactionState,
  RefMapElementInput,
  RefMapElementRef,
  RefMapRecord,
  RetentionState,
  ScreenshotArtifactInput,
  SnapshotCaptureResult,
  SnapshotRecord,
  SourceTrace,
  StorageScope
} from "./page-scene.js";
export type {
  FormInputStateField,
  InputExportPolicy,
  InputSensitivity,
  InputValueState,
  PreWriteGuardStatus,
  PreviewEvidenceInput,
  PreviewEvidenceState,
  PreviewEvidenceStatusFixture,
  RedactedPreviewExportFixture,
  WritableTargetRef,
  WritableTargetRole,
  WritePrecheckFacts,
  WritePrecheckInput
} from "./runtime-fixtures.js";
export type {
  IdentityConsistencyFacts,
  IdentityConsistencyFactsInput,
  IdentityConsistencyReadiness,
  IdentityConsistencyResourceFact,
  IdentityConsistencyResourceKey,
  IdentityConsistencyRiskEvent,
  IdentityConsistencyRiskState,
  IdentityConsistencyState
} from "./identity-consistency.js";
export type {
  BrowserStorageState,
  ExportPolicy,
  HumanVerificationKind,
  LocalIdentityEnvironmentFacts,
  LocalIdentityEnvironmentInput,
  LoginState,
  ManualAuthenticationState,
  MaterialBoundary,
  ProtectedMaterialClass,
  SiteBindingInput
} from "./identity-environment.js";
export type {
  LocalIdentityEnvironmentManagerOptions,
  LocalIdentityEnvironmentOperation,
  LocalIdentityEnvironmentPublicRecord,
  LocalIdentityEnvironmentReadiness,
  LocalIdentityEnvironmentStateUpdate,
  ManagedLocalIdentityEnvironmentInput,
  ManagedSiteId,
  StoredLocalIdentityEnvironmentRecord
} from "./identity-environment-manager.js";
export type {
  IdentityEnvironmentCreateInput,
  IdentityEnvironmentConfigurationUpdate,
  IdentityEnvironmentImportInput,
  IdentityEnvironmentMutationFailureCode,
  IdentityEnvironmentMutationOperation,
  IdentityEnvironmentMutationRequest,
  IdentityEnvironmentMutationResult
} from "./identity-environment-mutation-types.js";
export type {
  BrowserProviderCapabilityFact,
  BrowserProviderCapabilityKey,
  BrowserProviderCapabilityState,
  BrowserProviderCatalog,
  BrowserProviderDetectionInput,
  BrowserProviderDiagnostic,
  BrowserProviderDownloadGuide,
  BrowserProviderFailureClass,
  BrowserProviderId,
  BrowserProviderInstallFacts,
  BrowserProviderInstallStatus,
  BrowserProviderLaunchability,
  BrowserProviderRole,
  BrowserProviderStatus,
  IdentityEnvironmentProviderBinding,
  IdentityEnvironmentProviderBindingInput
} from "./provider-management.js";
export type {
  ManagedProviderLifecycleCommandResult,
  ManagedProviderLifecycleError,
  ManagedProviderLifecycleOptions,
  ManagedProviderLifecycleProgress,
  ManagedProviderLifecycleState,
  ManagedProviderLifecycleStatus,
  ManagedProviderOperationInput,
  ManagedProviderOperationKind
} from "./managed-provider-lifecycle.js";
export type {
  /** @deprecated Compatibility-only site read-operation request. */
  AllowlistedReadOperationRequest,
  /** @deprecated Compatibility-only normalized read-operation output. */
  CompletedReadOperation,
  /** @deprecated Compatibility-only failure taxonomy. */
  ReadOperationFailureClass,
  /** @deprecated Compatibility-only observation record. */
  ReadOperationObservationRecord,
  /** @deprecated Compatibility-only ref shape. */
  ReadOperationRef,
  /** @deprecated Compatibility-only unavailable shape. */
  ReadOperationUnavailable
} from "./read-operation.js";
/** @deprecated These site/provider probe types are retained only for rollback compatibility. */
export type {
  SiteResourceFact,
  SiteResourceFactSeverity,
  SiteResourceFactSource,
  SiteResourceFactState,
  SiteResourceFacts,
  SiteResourceFactsInput,
  SiteResourceFactsUnavailable,
  SiteRuntimeId
} from "./site-runtime-facts.js";
export type {
  AvailabilityState,
  CreateRuntimeSessionInput,
  FactSource,
  LifecycleState,
  LocalProviderLauncher,
  LocalProviderLaunchInput,
  LocalProviderLaunchResult,
  LocalProviderPageFacts,
  /** @deprecated Provider-specific read probe input retained for legacy adapter compatibility. */
  LocalProviderReadProbeInput,
  /** @deprecated Provider-specific normalized read summary retained for legacy adapter compatibility. */
  LocalProviderReadProbePublicSummary,
  /** @deprecated Provider-specific read probe result retained for legacy adapter compatibility. */
  LocalProviderReadProbeResult,
  LocalProviderScreenshotFacts,
  /** @deprecated Provider-specific site readiness probe input retained for legacy adapter compatibility. */
  LocalProviderSiteResourceProbeInput,
  /** @deprecated Provider-specific site readiness key retained for legacy adapter compatibility. */
  LocalProviderSiteResourceReadinessFactKey,
  /** @deprecated Provider-specific site readiness probe result retained for legacy adapter compatibility. */
  LocalProviderSiteResourceProbeResult,
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
} from "./runtime-session.js";
export type {
  AppBrowserStatus,
  AppRuntimeStatusFixture,
  ControlOwner,
  ControlOwnerFacts,
  CoreRuntimeFacts,
  HandoffReason,
  InputCapability,
  RecordHandoffInput,
  TakeoverUnavailableReason,
  ViewerAccessMode,
  ViewerAvailability,
  ViewerControlFacts,
  ViewerControlFailureClass,
  ViewerControlUnavailable,
  ViewerRefFacts,
  ViewerTransport
} from "./viewer-control.js";

export class HarborRuntime {
  private readonly pageScenes = new PageSceneStore();
  private readonly readOperationObservations = new ReadOperationObservationStore();
  private readonly detailReadTargets = new DetailReadTargetStore();
  private readonly viewerControls = new ViewerControlStore();
  private readonly identityEnvironments: LocalIdentityEnvironmentManager;
  private readonly runtimeSessions: RuntimeSessionStore;
  private readonly providerLifecycle: ManagedProviderLifecycle;

  constructor(
    launcher: LocalProviderLauncher = launchLocalDedicatedProvider,
    identityEnvironmentOptions: LocalIdentityEnvironmentManagerOptions = {},
    providerLifecycleOptions: ManagedProviderLifecycleOptions = {}
  ) {
    const ownerOptions = withProfileBackedLocalMaterial(identityEnvironmentOptions);
    this.identityEnvironments = new LocalIdentityEnvironmentManager(ownerOptions);
    this.runtimeSessions = new RuntimeSessionStore(this.viewerControls, launcher, {
      resolve_proxy: ownerOptions.resolve_proxy,
      on_session_closed: (runtimeSessionRef) => this.detailReadTargets.clearSession(runtimeSessionRef)
    });
    this.providerLifecycle = new ManagedProviderLifecycle(providerLifecycleOptions);
  }

  async createSession(input: CreateRuntimeSessionInput = {}): Promise<RuntimeSessionFacts> {
    return this.runtimeSessions.createSession(input);
  }

  getSession(runtime_session_ref: string): RuntimeSessionFacts | null {
    return this.runtimeSessions.getSession(runtime_session_ref);
  }

  completeManualAuthentication(
    runtime_session_ref: string,
    grant?: ManualAuthenticationAuthorizationGrant
  ): LocalIdentityEnvironmentPublicRecord | ManualAuthenticationCompletionUnavailable {
    return this.completeBoundManualAuthentication(
      runtime_session_ref,
      consumeManualAuthenticationAuthorizationGrant(grant, runtime_session_ref)
    );
  }

  private completeBoundManualAuthentication(
    runtime_session_ref: string,
    allowLocalProviderUserLock: boolean
  ): LocalIdentityEnvironmentPublicRecord | ManualAuthenticationCompletionUnavailable {
    const session = this.runtimeSessions.getRecord(runtime_session_ref);
    if (!session) return manualAuthenticationUnavailable("session_missing", runtime_session_ref);
    if (session.facts.lifecycle_state !== "active") return manualAuthenticationUnavailable("session_not_active", runtime_session_ref);
    if (!session.facts.identity_environment_ref) return manualAuthenticationUnavailable("identity_environment_unmanaged", runtime_session_ref);
    if (
      (!this.runtimeSessions.isTrustedUserHeldSession(runtime_session_ref) &&
        !(allowLocalProviderUserLock && this.runtimeSessions.isSupervisorConfirmableLocalProviderUserSession(runtime_session_ref))) ||
      session.facts.control_owner !== "user" ||
      session.facts.control_lock.owner !== "user" ||
      session.facts.control_lock.state !== "held"
    ) {
      return manualAuthenticationUnavailable("user_confirmation_required", runtime_session_ref);
    }

    const managedIdentityEnvironment = this.identityEnvironments.getFacts(session.facts.identity_environment_ref);
    if (
      !managedIdentityEnvironment ||
      managedIdentityEnvironment.identity_environment_ref !== session.facts.identity_environment_ref ||
      managedIdentityEnvironment.execution_identity_ref !== session.facts.execution_identity_ref ||
      managedIdentityEnvironment.profile_ref !== session.facts.profile_ref ||
      managedIdentityEnvironment.browser_storage.profile_storage_ref !== session.identity_binding.profile_storage_ref
    ) {
      return manualAuthenticationUnavailable("identity_environment_unmanaged", runtime_session_ref);
    }
    const identityEnvironment = this.identityEnvironments.completeManualAuthentication(session.facts.identity_environment_ref, runtime_session_ref);
    if (identityEnvironment) this.runtimeSessions.markReadOperationUserConfirmed(runtime_session_ref);
    return identityEnvironment ?? manualAuthenticationUnavailable("identity_environment_unmanaged", runtime_session_ref);
  }

  async openIdentityEnvironmentSession(input: OpenIdentityEnvironmentSessionInput): Promise<RuntimeSessionFacts | RuntimeSessionUnavailable> {
    return this.runtimeSessions.openIdentityEnvironmentSession(input);
  }

  lockSession(runtime_session_ref: string, input: RuntimeSessionControlInput = {}): RuntimeSessionFacts | RuntimeSessionUnavailable {
    return this.runtimeSessions.lockSession(runtime_session_ref, input);
  }

  releaseSession(runtime_session_ref: string, input: RuntimeSessionControlInput = {}): RuntimeSessionFacts | RuntimeSessionUnavailable {
    return this.runtimeSessions.releaseSession(runtime_session_ref, input);
  }

  async stopSession(runtime_session_ref: string, input: RuntimeSessionControlInput = {}): Promise<RuntimeSessionFacts | RuntimeSessionUnavailable> {
    return this.runtimeSessions.stopSession(runtime_session_ref, input);
  }

  async close(): Promise<void> {
    await this.runtimeSessions.closeAllSessions();
    await this.providerLifecycle.close();
  }

  getBrowserProviderStatus(input: BrowserProviderDetectionInput = {}): BrowserProviderCatalog {
    return detectBrowserProviders(input);
  }

  getManagedProviderLifecycle(): ManagedProviderLifecycleStatus {
    return this.providerLifecycle.status();
  }

  async recheckManagedProviderLifecycle(): Promise<ManagedProviderLifecycleStatus> {
    return this.providerLifecycle.recheck();
  }

  async startManagedProviderOperation(input: ManagedProviderOperationInput): Promise<ManagedProviderLifecycleCommandResult> {
    return this.providerLifecycle.start(input);
  }

  async cancelManagedProviderOperation(): Promise<ManagedProviderLifecycleCommandResult> {
    return this.providerLifecycle.cancel();
  }

  getIdentityEnvironmentProviderBinding(input: IdentityEnvironmentProviderBindingInput = {}): IdentityEnvironmentProviderBinding {
    return bindIdentityEnvironmentDefaultProvider(input);
  }

  getLocalIdentityEnvironmentFacts(input: LocalIdentityEnvironmentInput): LocalIdentityEnvironmentFacts {
    return createLocalIdentityEnvironmentFacts(input);
  }

  createLocalIdentityEnvironment(input: ManagedLocalIdentityEnvironmentInput): LocalIdentityEnvironmentPublicRecord {
    return this.identityEnvironments.create(input);
  }

  importLocalIdentityEnvironment(input: ManagedLocalIdentityEnvironmentInput): LocalIdentityEnvironmentPublicRecord {
    return this.identityEnvironments.importIdentityEnvironment(input);
  }

  updateLocalIdentityEnvironment(identity_environment_ref: string, input: LocalIdentityEnvironmentStateUpdate): LocalIdentityEnvironmentPublicRecord | null {
    return this.identityEnvironments.update(identity_environment_ref, input);
  }

  getManagedLocalIdentityEnvironment(identity_environment_ref: string): LocalIdentityEnvironmentPublicRecord | null {
    return this.identityEnvironments.get(identity_environment_ref);
  }

  listLocalIdentityEnvironments(): LocalIdentityEnvironmentPublicRecord[] {
    return this.identityEnvironments.list();
  }

  mutateLocalIdentityEnvironment(request: IdentityEnvironmentMutationRequest): IdentityEnvironmentMutationResult {
    const materializedRequest = materializeIdentityEnvironmentMutation(request);
    const reservationRefs = this.mutationReservationRefs(materializedRequest);
    const sourceInUse = reservationRefs.source_identity_environment_ref &&
      this.runtimeSessions.isIdentityEnvironmentInUse(reservationRefs.source_identity_environment_ref) ||
      reservationRefs.source_profile_storage_ref && this.runtimeSessions.isProfileStorageInUse(reservationRefs.source_profile_storage_ref);
    if (sourceInUse) {
      const code = request.operation === "copy_full" || request.operation === "copy_environment" || request.operation === "import"
        ? "source_in_use"
        : "active_session";
      return this.identityEnvironments.mutate(request, { code, recovery_actions: ["focus_or_stop_session", "retry"] });
    }
    const targetInUse = reservationRefs.target_identity_environment_ref &&
      this.runtimeSessions.isIdentityEnvironmentInUse(reservationRefs.target_identity_environment_ref) ||
      reservationRefs.target_profile_storage_ref && this.runtimeSessions.isProfileStorageInUse(reservationRefs.target_profile_storage_ref);
    if (targetInUse) {
      return this.identityEnvironments.mutate(request, { code: "target_in_use", recovery_actions: ["focus_or_stop_session", "retry"] });
    }
    const releaseReservation = this.runtimeSessions.reserveIdentityEnvironmentMutation(
      [reservationRefs.source_identity_environment_ref, reservationRefs.target_identity_environment_ref].filter((ref): ref is string => Boolean(ref)),
      [reservationRefs.source_profile_storage_ref, reservationRefs.target_profile_storage_ref].filter((ref): ref is string => Boolean(ref))
    );
    if (!releaseReservation) {
      const code = request.operation === "copy_full" || request.operation === "copy_environment" ? "target_in_use" : "active_session";
      return this.identityEnvironments.mutate(request, { code, recovery_actions: ["focus_or_stop_session", "retry"] });
    }
    try {
      if (materializedRequest.operation === "create" || materializedRequest.operation === "import") {
        const profileStorageRef = requestedProfileStorageRef(materializedRequest.identity_environment);
        if (profileStorageHasExternalLock(profileStorageRef)) {
          return this.identityEnvironments.mutate(request, { code: "profile_locked", recovery_actions: ["close_external_browser", "retry"] });
        }
        if (request.operation === "create" && profileStoragePathExists(profileStorageRef)) {
          return this.identityEnvironments.mutate(request, { code: "profile_storage_exists", recovery_actions: ["choose_new_target"] });
        }
        if (request.operation === "import" && !profileStoragePathExists(profileStorageRef)) {
          return this.identityEnvironments.mutate(request, { code: "source_material_missing", recovery_actions: ["locate_source_profile", "retry"] });
        }
        return this.identityEnvironments.mutate(request);
      }
      if (!("identity_environment_ref" in request)) return this.identityEnvironments.mutate(request);
      const identityEnvironmentRef = request.identity_environment_ref;
      if (this.runtimeSessions.isIdentityEnvironmentInUse(identityEnvironmentRef)) {
        const code = request.operation === "copy_full" || request.operation === "copy_environment" ? "source_in_use" : "active_session";
        return this.identityEnvironments.mutate(request, { code, recovery_actions: ["focus_or_stop_session", "retry"] });
      }
      const facts = this.identityEnvironments.getFacts(identityEnvironmentRef);
      if (facts && profileStorageHasExternalLock(facts.browser_storage.profile_storage_ref)) {
        return this.identityEnvironments.mutate(request, { code: "profile_locked", recovery_actions: ["close_external_browser", "retry"] });
      }
      return this.identityEnvironments.mutate(request);
    } finally {
      releaseReservation();
    }
  }

  private mutationReservationRefs(request: MaterializedIdentityEnvironmentMutationRequest): {
    source_identity_environment_ref: string | null;
    source_profile_storage_ref: string | null;
    target_identity_environment_ref: string | null;
    target_profile_storage_ref: string | null;
  } {
    if (request.operation === "create" || request.operation === "import") {
      return {
        source_identity_environment_ref: request.operation === "import" ? request.identity_environment.identity_environment_ref ?? null : null,
        source_profile_storage_ref: request.operation === "import" ? requestedProfileStorageRef(request.identity_environment) : null,
        target_identity_environment_ref: request.identity_environment.identity_environment_ref ?? null,
        target_profile_storage_ref: request.operation === "create" ? requestedProfileStorageRef(request.identity_environment) : null
      };
    }
    if (!("identity_environment_ref" in request)) throw new TypeError("Mutation request is missing an identity reference.");
    const facts = this.identityEnvironments.getFacts(request.identity_environment_ref);
    return {
      source_identity_environment_ref: request.identity_environment_ref,
      source_profile_storage_ref: facts?.browser_storage.profile_storage_ref ?? null,
      target_identity_environment_ref: request.operation === "copy_full" || request.operation === "copy_environment"
        ? request.target.identity_environment_ref
        : null,
      target_profile_storage_ref: request.operation === "copy_full" || request.operation === "copy_environment"
        ? `${request.target.profile_ref}:storage`
        : null
    };
  }

  deleteLocalIdentityEnvironment(identity_environment_ref: string): LocalIdentityEnvironmentPublicRecord | null {
    return this.identityEnvironments.delete(identity_environment_ref);
  }

  async openManagedIdentityEnvironmentSession(input: Omit<OpenIdentityEnvironmentSessionInput, "identity_environment"> & { identity_environment_ref: string }): Promise<RuntimeSessionFacts | RuntimeSessionUnavailable> {
    const identity_environment = this.identityEnvironments.getFacts(input.identity_environment_ref);
    if (!identity_environment) {
      return {
        status: "unavailable",
        failure_class: "identity_environment_unavailable",
        message: "Local identity environment is not registered.",
        retryable: true,
        current_error: {
          code: "identity_environment_unavailable",
          message: "Local identity environment is not registered.",
          retryable: true
        }
      };
    }
    const session = await this.runtimeSessions.openIdentityEnvironmentSession({ ...input, identity_environment });
    this.bindPersistedAuthenticationToHeadedUserSession(identity_environment, session, input);
    this.bindPersistedAuthenticationToCoreReadSession(identity_environment, session, input);
    return session;
  }

  async openManagedDefaultSiteSession(input: Omit<OpenIdentityEnvironmentSessionInput, "identity_environment" | "url"> & { identity_environment_ref: string }): Promise<RuntimeSessionFacts | RuntimeSessionUnavailable> {
    const identity_environment = this.identityEnvironments.getFacts(input.identity_environment_ref);
    if (!identity_environment) {
      return {
        status: "unavailable",
        failure_class: "identity_environment_unavailable",
        message: "Local identity environment is not registered.",
        retryable: true,
        current_error: {
          code: "identity_environment_unavailable",
          message: "Local identity environment is not registered.",
          retryable: true
        }
      };
    }
    const session = await this.runtimeSessions.openIdentityEnvironmentSession({
      ...input,
      identity_environment,
      url: defaultIdentitySiteUrl(identity_environment.site_binding.site_id, identity_environment.site_binding.origin)
    });
    this.bindPersistedAuthenticationToHeadedUserSession(identity_environment, session, input);
    this.bindPersistedAuthenticationToCoreReadSession(identity_environment, session, input);
    return session;
  }

  private bindPersistedAuthenticationToCoreReadSession(
    identity_environment: LocalIdentityEnvironmentFacts,
    session: RuntimeSessionFacts | RuntimeSessionUnavailable,
    input: Pick<OpenIdentityEnvironmentSessionInput, "control_owner">
  ): void {
    if (input.control_owner !== "core_task" || "status" in session ||
      identity_environment.login_state.state !== "logged_in" ||
      (identity_environment.login_state.manual_authentication_state !== "completed" &&
        identity_environment.login_state.manual_authentication_state !== "not_required") ||
      identity_environment.login_state.recovery_required || identity_environment.browser_storage.state !== "present") return;
    this.runtimeSessions.markPersistedReadOperationEligible(session.runtime_session_ref);
  }

  private bindPersistedAuthenticationToHeadedUserSession(
    identity_environment: LocalIdentityEnvironmentFacts,
    session: RuntimeSessionFacts | RuntimeSessionUnavailable,
    input: Pick<OpenIdentityEnvironmentSessionInput, "control_owner" | "headless">
  ): void {
    if ("status" in session) return;
    const record = this.runtimeSessions.getRecord(session.runtime_session_ref);
    if (
      input.control_owner !== "user" ||
      input.headless === true ||
      !record ||
      !sameManagedIdentity(record, identity_environment) ||
      !this.runtimeSessions.isSupervisorConfirmableLocalProviderUserSession(session.runtime_session_ref)
    ) return;
    if (!this.identityEnvironments.rebindUserConfirmedManagedSession(
      identity_environment.identity_environment_ref,
      session.runtime_session_ref
    )) return;
    this.runtimeSessions.markReadOperationUserConfirmed(session.runtime_session_ref);
  }

  getIdentityConsistencyFacts(input: IdentityConsistencyFactsInput): IdentityConsistencyFacts {
    return createIdentityConsistencyFacts(input);
  }

  captureSnapshot(runtime_session_ref: string, input: CaptureSnapshotInput = {}): SnapshotCaptureResult {
    const record = this.runtimeSessions.getRecord(runtime_session_ref);
    const result = this.pageScenes.capture(record?.facts ?? null, input);
    if (record && result.status === "captured") {
      this.runtimeSessions.markSnapshotCaptured(runtime_session_ref, result.core_scene_ref.captured_at, result.evidence_refs);
    }
    return result;
  }

  async captureLiveSnapshot(runtime_session_ref: string, input: CaptureSnapshotInput = {}): Promise<SnapshotCaptureResult> {
    const record = this.runtimeSessions.getRecord(runtime_session_ref);
    if (!record) return this.pageScenes.capture(null, input);
    const screenshot = await record.captureScreenshot?.();
    const screenshot_artifact = screenshot && !("code" in screenshot) ? screenshotArtifact(screenshot) : undefined;
    const evidence_policy = screenshot && "code" in screenshot ? { ...input.evidence_policy, screenshot: "deny" as const } : input.evidence_policy;
    const result = this.pageScenes.capture(record.facts, {
      title: input.title ?? record.facts.current_page.title ?? "Untitled page",
      url: input.url ?? record.facts.current_page.current_url ?? record.facts.current_page.requested_url,
      summary: input.summary ?? "Live browser page captured as Harbor refs with raw screenshot bytes withheld.",
      capture_method: input.capture_method ?? (screenshot_artifact ? "cdp_screenshot" : "provided_context"),
      source_locator: input.source_locator ?? `runtime-session://${runtime_session_ref}/current-page`,
      elements: input.elements,
      screenshot_artifact,
      evidence_policy
    });
    if (result.status === "captured") {
      this.runtimeSessions.markSnapshotCaptured(runtime_session_ref, result.core_scene_ref.captured_at, result.evidence_refs);
      if (screenshot && !("code" in screenshot)) record.facts.facts.push(...screenshot.facts);
    }
    return result;
  }

  /** @deprecated Use the namespaced `legacyReadOperation` adapter and migrate callers to Core-owned admission. */
  async executeAllowlistedReadOperation(
    runtime_session_ref: string,
    input: unknown
  ): Promise<CompletedReadOperation | ReadOperationUnavailable> {
    return this.executeLegacyReadOperation(runtime_session_ref, input);
  }

  async executeLegacyReadOperation(
    runtime_session_ref: string,
    input: unknown
  ): Promise<CompletedReadOperation | ReadOperationUnavailable> {
    const admission = admitAllowlistedReadOperation(input);
    if (typeof admission === "string") return readOperationUnavailable(runtime_session_ref, admission);

    const preflightFailure = this.readOperationSessionFailure(runtime_session_ref, admission);
    if (preflightFailure) return readOperationUnavailable(runtime_session_ref, preflightFailure, requestIdentity(admission.request));
    const controlGeneration = this.runtimeSessions.getRecord(runtime_session_ref)!.control_generation;

    let consumedDetailTarget: DetailReadTargetRecord | null = null;
    if (admission.request.detail_ref) {
      const target = this.detailReadTargets.consume({
        detail_ref: admission.request.detail_ref,
        runtime_session_ref,
        site_id: admission.entry.site_id,
        operation_id: admission.entry.operation_id
      });
      if (typeof target === "string") return readOperationUnavailable(runtime_session_ref, target, requestIdentity(admission.request));
      consumedDetailTarget = target;
      admission.target_url = target.canonical_url;
    }

    const probe = await this.runtimeSessions.probeReadOperation(runtime_session_ref, {
      site_id: admission.entry.site_id,
      operation_id: admission.entry.operation_id,
      target_url: admission.target_url,
      expected_origin: admission.entry.allowed_origin,
      query: admission.request.query,
      city_code: admission.request.city_code,
      limit: admission.request.limit,
      detail_ref: admission.request.detail_ref
    });
    if (probe.status === "unavailable") {
      if (
        probe.retryable &&
        consumedDetailTarget &&
        this.runtimeSessions.getRecord(runtime_session_ref)?.control_generation === controlGeneration &&
        !this.readOperationSessionFailure(runtime_session_ref, admission)
      ) this.detailReadTargets.restoreAfterRetryableFailure(consumedDetailTarget);
      return readOperationUnavailable(runtime_session_ref, probe.failure_class, {
        ...requestIdentity(admission.request),
        retryable: probe.retryable
      });
    }
    const postProbeFailure = this.readOperationSessionFailure(runtime_session_ref, admission);
    if (postProbeFailure) return readOperationUnavailable(runtime_session_ref, postProbeFailure, requestIdentity(admission.request));

    const detail_refs = probe.detail_targets && (admission.entry.operation_id === "xhs_search_notes" || admission.entry.operation_id === "boss_job_search")
      ? this.detailReadTargets.register({
          runtime_session_ref,
          site_id: admission.entry.site_id,
          search_operation_id: admission.entry.operation_id,
          targets: probe.detail_targets
        })
      : [];
    const publicSummary = detail_refs.length > 0
      ? {
          ...probe.public_summary,
          detail_refs,
          ...(admission.entry.operation_id === "xhs_search_notes" && probe.search_items?.length === detail_refs.length
            ? {
                schema_version: "harbor-read-operation-public-summary/v1" as const,
                items: probe.search_items.map((item, index) => ({ ...item, detail_ref: detail_refs[index]! }))
              }
            : {})
        }
      : probe.public_summary;
    const proof = this.readOperationObservations.capture({
      operation_ref: opaqueRef("read_operation"),
      runtime_session_ref,
      entry: admission.entry,
      observed_origin: probe.observed_origin,
      observed_at: probe.observed_at,
      source_refs: probe.source_refs,
      evidence_ref_kinds: probe.evidence_ref_kinds,
      public_summary_source_ref: probe.public_summary_source_ref,
      public_summary: publicSummary,
    });
    if (typeof proof === "string") return readOperationUnavailable(runtime_session_ref, proof, requestIdentity(admission.request));
    const result = this.readOperationObservations.complete(admission.entry, proof);
    if (typeof result === "string") return readOperationUnavailable(runtime_session_ref, result, requestIdentity(admission.request));
    return result;
  }

  private readOperationSessionFailure(runtime_session_ref: string, admission: AdmittedReadOperation): ReadOperationFailureClass | null {
    const session = this.runtimeSessions.getRecord(runtime_session_ref);
    if (!session) return "session_missing";
    const managedIdentity = session.facts.identity_environment_ref
      ? this.identityEnvironments.getFacts(session.facts.identity_environment_ref)
      : null;
    if (!managedIdentity || !sameManagedIdentity(session, managedIdentity)) return "session_unmanaged";
    if (
      managedIdentity.site_binding.site_id !== admission.entry.site_id ||
      managedIdentity.site_binding.origin !== admission.entry.allowed_origin
    ) return "target_origin_not_allowed";
    if (
      !isRuntimeSessionReadable(session.facts) ||
      session.facts.availability.cdp !== "available" ||
      session.facts.current_error
    ) return "session_not_ready";
    if (
      managedIdentity.login_state.state !== "logged_in" ||
      (managedIdentity.login_state.manual_authentication_state !== "completed" &&
        managedIdentity.login_state.manual_authentication_state !== "not_required") ||
      managedIdentity.login_state.recovery_required
    ) return "not_logged_in";
    if (!hasStableReadOperationController(session, admission.request.holder_ref)) return "session_user_controlled";
    return isChallengeLike(session.facts.current_page.current_url, session.facts.current_page.title) ? "safety_challenge" : null;
  }

  getSnapshot(snapshot_ref: string): SnapshotRecord | PageSceneUnavailable {
    return this.pageScenes.getSnapshot(snapshot_ref, (runtime_session_ref) => this.runtimeSessions.isReadable(runtime_session_ref));
  }

  getRefMap(refmap_ref: string): RefMapRecord | PageSceneUnavailable {
    return this.pageScenes.getRefMap(refmap_ref, (runtime_session_ref) => this.runtimeSessions.isReadable(runtime_session_ref));
  }

  getEvidence(evidence_ref: string): EvidenceRecord | PageSceneUnavailable {
    return this.pageScenes.getEvidence(evidence_ref);
  }

  getPublicEvidence(evidence_ref: string): EvidenceRecord | ReadOperationObservationRecord | PageSceneUnavailable {
    const sceneEvidence = this.getEvidence(evidence_ref);
    if (!("status" in sceneEvidence)) return sceneEvidence;
    return this.readOperationObservations.get(evidence_ref) ?? sceneEvidence;
  }

  expireEvidence(evidence_ref: string): EvidenceRecord | PageSceneUnavailable {
    return this.pageScenes.expireEvidence(evidence_ref);
  }

  getCoreSceneReference(snapshot_ref: string): CoreSceneReference | PageSceneUnavailable {
    return this.pageScenes.getCoreSceneReference(snapshot_ref, (runtime_session_ref) => this.runtimeSessions.isReadable(runtime_session_ref));
  }

  getEvidenceStatusFixture(snapshot_ref: string): EvidenceStatusFixture | PageSceneUnavailable {
    return this.pageScenes.getEvidenceStatusFixture(snapshot_ref, (runtime_session_ref) => this.runtimeSessions.isReadable(runtime_session_ref));
  }

  capturePreviewEvidence(runtime_session_ref: string, input: PreviewEvidenceInput = {}): PreviewEvidenceStatusFixture | PageSceneUnavailable {
    const capture = this.captureSnapshot(runtime_session_ref, {
      title: input.title ?? "Before preview fixture",
      url: input.url ?? "https://example.test/write-precheck",
      summary: input.summary ?? "Before-preview redacted target state.",
      capture_method: input.capture_method ?? "fixture",
      source_locator: input.source_locator ?? "fixture://before-preview",
      elements: input.elements ?? [{ label: "Contact form", role: "form", locator_hint: "form[data-webenvoy-fixture='contact']" }],
      evidence_policy: input.evidence_policy
    });
    if (capture.status !== "captured") {
      return capture;
    }
    return this.getPreviewEvidenceStatusFixture(capture.snapshot_ref, input.current_url);
  }

  getPreviewEvidenceStatusFixture(snapshot_ref: string, current_url?: string): PreviewEvidenceStatusFixture | PageSceneUnavailable {
    const scene = this.getCoreSceneReference(snapshot_ref);
    if ("status" in scene) {
      return scene;
    }
    const evidenceStatus = this.getEvidenceStatusFixture(snapshot_ref);
    if ("status" in evidenceStatus) {
      return evidenceStatus;
    }
    const observedUrl = current_url ?? scene.page_summary.url;
    const evidenceUnavailable = evidenceStatus.evidence_status.some((entry) =>
      entry.display_state === "expired" || entry.display_state === "missing" || entry.display_state === "unavailable"
    );
    const pageChanged = observedUrl !== scene.page_summary.url;
    const stale = evidenceStatus.scene_status.display_state === "stale";
    const state: PreviewEvidenceState = evidenceUnavailable ? "evidence_unavailable" : pageChanged ? "page_changed" : stale ? "stale_refmap" : "available";
    return {
      schema_version: HARBOR_PREVIEW_EVIDENCE_STATUS_FIXTURE_SCHEMA,
      runtime_session_ref: scene.runtime_session_ref,
      before_preview: scene,
      target_state_provenance: {
        snapshot_ref: scene.snapshot_ref,
        refmap_ref: scene.refmap_ref,
        source_trace_ref: scene.source_trace_ref,
        captured_at: scene.captured_at,
        captured_url: scene.page_summary.url,
        current_url: observedUrl,
        producer: "harbor_runtime_api"
      },
      freshness: {
        state,
        blocking_reason: state === "available" ? null : state === "stale_refmap" ? "refmap_stale" : state,
        retryable: state !== "available"
      },
      viewer_evidence_status: evidenceStatus,
      privacy_boundary: {
        raw_material: "not_exposed",
        export_boundary: "refs_and_redacted_status_only",
        credential_storage: "not_exposed"
      },
      unavailable: null
    };
  }

  getRedactedPreviewExportFixture(snapshot_ref: string, current_url?: string): RedactedPreviewExportFixture | PageSceneUnavailable {
    const preview = this.getPreviewEvidenceStatusFixture(snapshot_ref, current_url);
    if ("status" in preview) {
      return preview;
    }
    return {
      schema_version: HARBOR_REDACTED_PREVIEW_EXPORT_FIXTURE_SCHEMA,
      runtime_session_ref: preview.runtime_session_ref,
      before_preview_refs: {
        snapshot_ref: preview.before_preview.snapshot_ref,
        refmap_ref: preview.before_preview.refmap_ref,
        source_trace_ref: preview.before_preview.source_trace_ref,
        evidence_refs: preview.before_preview.evidence_refs
      },
      preview_state: preview.freshness.state,
      no_submit_guard: {
        status: "active",
        blocked_events: ["submit", "publish", "send", "delete", "pay"],
        enforcement: "facts_only_no_real_submit"
      },
      private_boundary: {
        local_capture_store: "process_memory_only",
        restricted_material: "not_exported",
        export_boundary: "redacted_preview_refs_only"
      },
      redacted_export: {
        page_summary: preview.before_preview.page_summary,
        evidence_status: preview.viewer_evidence_status.evidence_status
      },
      unavailable: null
    };
  }

  getViewerControlFacts(runtime_session_ref: string): ViewerControlFacts | ViewerControlUnavailable {
    return this.viewerControls.get(runtime_session_ref);
  }

  recordHandoff(runtime_session_ref: string, input: RecordHandoffInput): ViewerControlFacts | ViewerControlUnavailable {
    const result = this.viewerControls.recordHandoff(runtime_session_ref, input);
    if (!("status" in result)) {
      this.runtimeSessions.applyHandoff(runtime_session_ref, result.control);
    }
    return result;
  }

  getCoreRuntimeFacts(runtime_session_ref: string): CoreRuntimeFacts | ViewerControlUnavailable {
    const record = this.runtimeSessions.getRecord(runtime_session_ref);
    if (!record) {
      return { status: "unavailable", failure_class: "session_missing", message: "Runtime Session is missing.", retryable: true };
    }
    const viewerControl = this.viewerControls.get(runtime_session_ref);
    if ("status" in viewerControl) return viewerControl;
    return coreRuntimeFacts(record.facts, viewerControl);
  }

  getValidationRuntimeFacts(runtime_session_ref: string): ValidationRuntimeFacts | ViewerControlUnavailable {
    const facts = this.runtimeSessions.getValidationRuntimeFacts(runtime_session_ref);
    if (!facts) {
      return { status: "unavailable", failure_class: "session_missing", message: "Runtime Session is missing.", retryable: true };
    }
    return facts;
  }

  getWritePrecheckFacts(runtime_session_ref: string, input: WritePrecheckInput = {}): WritePrecheckFacts | ViewerControlUnavailable {
    const record = this.runtimeSessions.getRecord(runtime_session_ref);
    if (!record) {
      return { status: "unavailable", failure_class: "session_missing", message: "Runtime Session is missing.", retryable: true };
    }
    const boundedInput = sessionBoundWritePrecheckInput(input);
    const capture = this.captureSnapshot(runtime_session_ref, {
      title: record.facts.current_page.title ?? "Write precheck target",
      url: record.facts.current_page.current_url ?? record.facts.current_page.requested_url,
      summary: "Refs-only target state for validate-only write precheck.",
      capture_method: "provided_context",
      source_locator: `runtime-session://${runtime_session_ref}/write-precheck`,
      elements: [
        { label: boundedInput.target_label ?? "Write target", role: "form", locator_hint: "runtime-session://current-write-target" }
      ]
    });
    if (capture.status !== "captured") {
      return { status: "unavailable", failure_class: "viewer_unavailable", message: capture.message, retryable: capture.retryable };
    }
    const now = capture.core_scene_ref.captured_at;
    const target_ref = opaqueRef("writable-target");
    const fields = (boundedInput.fields ?? [
      { label: "Email", input_kind: "email", required: true, sensitivity: "sensitive", export_policy: "redacted", value_state: "redacted" },
      { label: "Message", input_kind: "textarea", required: true, sensitivity: "public", export_policy: "safe_summary", value_state: "present" },
      { label: "Password", input_kind: "password", required: false, sensitivity: "secret", export_policy: "never_export", value_state: "unavailable" }
    ]).map((field) => ({
      field_ref: opaqueRef("field"),
      target_ref,
      label: field.label,
      input_kind: field.input_kind ?? "text",
      required: field.required ?? false,
      sensitivity: field.sensitivity ?? "public",
      export_policy: field.export_policy ?? (field.sensitivity === "secret" ? "never_export" : "safe_summary"),
      value_state: field.value_state ?? (field.sensitivity === "secret" ? "unavailable" : "present")
    }));
    return {
      schema_version: HARBOR_WRITE_PRECHECK_FACTS_SCHEMA,
      runtime_session_ref,
      provider_ref: record.facts.provider_ref,
      profile_ref: record.facts.profile_ref,
      writable_target: {
        target_ref,
        runtime_session_ref,
        snapshot_ref: capture.snapshot_ref,
        refmap_ref: capture.refmap_ref ?? "",
        evidence_refs: capture.evidence_refs,
        role: "form",
        label: boundedInput.target_label ?? "Write target",
        locator_hint: "runtime-session://current-write-target",
        provenance: {
          source: "provided_context",
          captured_at: now
        }
      },
      submitted: false,
      form_state: {
        snapshot_ref: capture.snapshot_ref,
        fields,
        state_summary: "Field values are summarized as state only; raw values stay private."
      },
      pre_write_guard: {
        status: record.facts.lifecycle_state === "active" || record.facts.lifecycle_state === "idle" ? "active" : "blocked",
        no_submit_guard: "active",
        blocked_events: ["submit", "publish", "send", "delete", "pay"],
        enforcement: "facts_only_no_real_submit",
        runtime_ready: record.facts.lifecycle_state === "active" || record.facts.lifecycle_state === "idle",
        blocking_reasons: record.facts.current_error ? [record.facts.current_error] : []
      },
      privacy_boundary: {
        raw_values: "not_exposed",
        credential_profile_storage: "not_exposed",
        page_network_capture: "not_exposed",
        export_boundary: "refs_and_redacted_field_state_only"
      },
      unavailable: null
    };
  }

  getSessionWritePrecheckFacts(runtime_session_ref: string, input: WritePrecheckInput = {}): WritePrecheckFacts | ViewerControlUnavailable {
    return this.getWritePrecheckFacts(runtime_session_ref, input);
  }

  /** @deprecated Site-specific resource facts remain only as a bounded compatibility adapter. */
  async getSiteResourceFacts(runtime_session_ref: string, input: SiteResourceFactsInput = {}, signal?: AbortSignal): Promise<SiteResourceFacts | SiteResourceFactsUnavailable> {
    return this.getLegacySiteResourceFacts(runtime_session_ref, input, signal);
  }

  async getLegacySiteResourceFacts(runtime_session_ref: string, input: SiteResourceFactsInput = {}, signal?: AbortSignal): Promise<SiteResourceFacts | SiteResourceFactsUnavailable> {
    const record = this.runtimeSessions.getRecord(runtime_session_ref);
    if (!record) return missingSiteRuntimeSession(runtime_session_ref, input);
    const capture = this.captureSnapshot(runtime_session_ref, {
      title: record.facts.current_page.title ?? "Site resource facts",
      url: record.facts.current_page.current_url ?? record.facts.current_page.requested_url,
      summary: "Refs-only site resource facts for Core admission.",
      capture_method: "provided_context",
      source_locator: `runtime-session://${runtime_session_ref}/site-resource-facts`,
      elements: siteResourceElements(input)
    });
    const taskKind = input.task_kind?.trim().toLowerCase().replace(/-/g, "_") ?? (input.site_id === "boss" ? "job_search" : undefined);
    const siteProbe = record.execution_surface === "local_provider" && input.site_id === "boss" && (taskKind === "job_search" || taskKind === "boss_job_search")
      ? await this.runtimeSessions.probeSiteResource(runtime_session_ref, { site_id: "boss", task_kind: taskKind, signal })
      : record.execution_surface === "local_provider" && input.site_id === "xiaohongshu" && (
        taskKind === "search_notes" ||
        taskKind === "xhs_search_notes" ||
        taskKind === "read_note_detail" ||
        taskKind === "xhs_read_note_detail"
      )
        ? await this.runtimeSessions.probeSiteResource(runtime_session_ref, { site_id: "xiaohongshu", task_kind: taskKind, signal })
        : undefined;
    return createSiteResourceFacts(record.facts, input, capture, siteProbe);
  }

  getAppRuntimeStatusFixture(runtime_session_ref: string): AppRuntimeStatusFixture | ViewerControlUnavailable {
    const record = this.runtimeSessions.getRecord(runtime_session_ref);
    if (!record) {
      return { status: "unavailable", failure_class: "session_missing", message: "Runtime Session is missing.", retryable: true };
    }
    const viewerControl = this.viewerControls.get(runtime_session_ref);
    if ("status" in viewerControl) return viewerControl;
    return appRuntimeStatusFixture(record.facts, viewerControl);
  }

  async closeSession(runtime_session_ref: string): Promise<RuntimeSessionFacts | null> {
    const result = await this.runtimeSessions.closeSession(runtime_session_ref);
    if (result) this.detailReadTargets.clearSession(runtime_session_ref);
    return result;
  }
}

function requestedProfileStorageRef(input: ManagedLocalIdentityEnvironmentInput): string {
  const identityRef = input.identity_environment_ref ?? "identity-env_fixture";
  const profileRef = input.profile_ref ?? `${identityRef}:profile`;
  return input.profile_storage_ref ?? `${profileRef}:storage`;
}

export interface ManualAuthenticationCompletionUnavailable {
  status: "unavailable";
  failure_class: "session_missing" | "session_not_active" | "identity_environment_unmanaged" | "user_confirmation_required";
  runtime_session_ref: string;
  retryable: false;
  public_boundary: {
    output: "status_and_redacted_refs_only";
    raw_material: "not_exposed";
  };
}

function manualAuthenticationUnavailable(
  failure_class: ManualAuthenticationCompletionUnavailable["failure_class"],
  runtime_session_ref: string
): ManualAuthenticationCompletionUnavailable {
  return {
    status: "unavailable",
    failure_class,
    runtime_session_ref,
    retryable: false,
    public_boundary: {
      output: "status_and_redacted_refs_only",
      raw_material: "not_exposed"
    }
  };
}

function sessionBoundWritePrecheckInput(input: WritePrecheckInput): WritePrecheckInput {
  return {
    target_label: input.target_label,
    fields: input.fields
  };
}

export function defaultIdentitySiteUrl(site_id: string, origin: string): string {
  if (site_id === "xiaohongshu") return DEFAULT_IDENTITY_SITE_URLS.xiaohongshu;
  if (site_id === "boss") return DEFAULT_IDENTITY_SITE_URLS.boss;
  return origin;
}

function screenshotArtifact(screenshot: { screenshot_ref: string; mime_type: "image/png"; byte_length: number; sha256: string }): ScreenshotArtifactInput {
  return {
    artifact_ref: screenshot.screenshot_ref,
    mime_type: screenshot.mime_type,
    byte_length: screenshot.byte_length,
    sha256: screenshot.sha256
  };
}

function sameManagedIdentity(session: RuntimeSessionRecord, identity: LocalIdentityEnvironmentFacts): boolean {
  return session.facts.identity_environment_ref === identity.identity_environment_ref &&
    session.facts.execution_identity_ref === identity.execution_identity_ref &&
    session.facts.profile_ref === identity.profile_ref &&
    session.identity_binding.profile_storage_ref === identity.browser_storage.profile_storage_ref;
}

function hasStableReadOperationController(session: RuntimeSessionRecord, holderRef?: string): boolean {
  return session.read_operation_user_handoff &&
    session.facts.control_owner === "core_task" &&
    session.facts.control_lock.state === "held" &&
    session.facts.control_lock.owner === session.facts.control_owner &&
    Boolean(session.facts.control_lock.holder_ref) &&
    (session.facts.lifecycle_state !== "locked" || holderRef === session.facts.control_lock.holder_ref) &&
    isRuntimeSessionReadable(session.facts);
}

function requestIdentity(input: { site_id: string; operation_id: string }): { site_id: string; operation_id: string } {
  return { site_id: input.site_id, operation_id: input.operation_id };
}

function isChallengeLike(url?: string | null, title?: string | null): boolean {
  const text = `${url ?? ""} ${title ?? ""}`.toLowerCase();
  return /captcha|challenge|verify|verification|security|安全|验证|校验/.test(text);
}
