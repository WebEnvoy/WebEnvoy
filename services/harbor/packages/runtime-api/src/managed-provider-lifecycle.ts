import { randomUUID } from "node:crypto";
import { access, mkdir, rename, rm } from "node:fs/promises";
import { arch as hostArch, homedir, platform as hostPlatform } from "node:os";
import { isAbsolute, join, relative } from "node:path";
import {
  CloakBrowserReleaseError,
  cloakBrowserPlatformTag,
  defaultCloakBrowserVersion,
  installCloakBrowserRelease,
  isCloakBrowserVersion,
  latestCloakBrowserVersion
} from "./cloakbrowser-release.js";
import {
  commitProviderExchange,
  providerExchangeJournal,
  publishProviderExchange,
  recoverProviderExchange,
  scavengeStaleProviderArtifacts,
  writeProviderExchangeJournal,
  writeProviderVersionMarker,
  type ProviderExchangeFileOperations,
  type ProviderExchangeJournal
} from "./managed-provider-exchange.js";
import { attemptProviderRollback, settleProviderOperation } from "./managed-provider-lifecycle-recovery.js";
import {
  acquireProviderCacheOwnership,
  ProviderCacheOwnershipBusy,
  type ProviderCacheOwnership
} from "./managed-provider-cache-ownership.js";
import { verifyLocalProviderLaunch } from "./local-provider-launcher.js";
import {
  type ManagedProviderLifecycleCommandResult,
  type ManagedProviderLifecycleError,
  type ManagedProviderLifecycleOptions,
  type ManagedProviderLifecycleState,
  type ManagedProviderLifecycleStatus,
  type ManagedProviderBeforeOperation,
  type ManagedProviderOperationInput
} from "./managed-provider-lifecycle-types.js";
import {
  baseStatus,
  cacheBusyError,
  compatibleBrowserVersion,
  error,
  progress,
  recoveryError,
  result,
  versionNewer
} from "./managed-provider-lifecycle-status.js";
import {
  detectBrowserProviders,
  resolveCloakBrowserOverride,
  type BrowserProviderDetectionInput
} from "./provider-management.js";

export { HARBOR_MANAGED_PROVIDER_LIFECYCLE_SCHEMA, isManagedProviderOperationInput } from "./managed-provider-lifecycle-types.js";
export type {
  ManagedProviderLifecycleCommandResult,
  ManagedProviderLifecycleError,
  ManagedProviderLifecycleOptions,
  ManagedProviderLifecycleProgress,
  ManagedProviderLifecycleState,
  ManagedProviderLifecycleStatus,
  ManagedProviderOperationInput,
  ManagedProviderOperationKind
} from "./managed-provider-lifecycle-types.js";
export class ManagedProviderLifecycle {
  private readonly cacheDir: string;
  private readonly env: Record<string, string | undefined>;
  private readonly platform: NodeJS.Platform;
  private readonly arch: string;
  private readonly installRelease: NonNullable<ManagedProviderLifecycleOptions["install_release"]>;
  private readonly resolveLatestVersion: NonNullable<ManagedProviderLifecycleOptions["resolve_latest_version"]>;
  private readonly verifyLaunch: NonNullable<ManagedProviderLifecycleOptions["verify_launch"]>;
  private readonly exchangeOperations: ProviderExchangeFileOperations;
  private readonly acquireCacheOwnership: NonNullable<ManagedProviderLifecycleOptions["acquire_cache_ownership"]>;
  private readonly now: () => Date;
  private current: ManagedProviderLifecycleStatus;
  private controller: AbortController | null = null;
  private running: Promise<void> | null = null;
  private activeOperationId: string | null = null;
  private recoveryBlocked = false;
  private controlTail: Promise<void> = Promise.resolve();
  private readonly initialization: Promise<void>;

  constructor(options: ManagedProviderLifecycleOptions = {}) {
    this.env = options.env ?? process.env;
    this.platform = options.platform ?? hostPlatform();
    this.arch = options.arch ?? hostArch();
    this.cacheDir = options.cache_dir ?? this.env.CLOAKBROWSER_CACHE_DIR ?? join(this.env.HOME ?? homedir(), ".cloakbrowser");
    this.installRelease = options.install_release ?? installCloakBrowserRelease;
    this.resolveLatestVersion = options.resolve_latest_version ?? ((platform, arch, signal) =>
      latestCloakBrowserVersion(platform, arch, fetch, signal));
    this.verifyLaunch = options.verify_launch ?? ((binaryPath, expectedVersion, signal) =>
      verifyLocalProviderLaunch(binaryPath, { expected_version: expectedVersion, signal }));
    this.exchangeOperations = options.exchange_file_operations ?? { rename, rm };
    this.acquireCacheOwnership = options.acquire_cache_ownership ?? acquireProviderCacheOwnership;
    this.now = options.now ?? (() => new Date());
    this.current = this.detectStatus();
    this.initialization = this.initializeCache();
  }

  status(): ManagedProviderLifecycleStatus {
    return structuredClone(this.current);
  }

  async recheck(): Promise<ManagedProviderLifecycleStatus> {
    return this.serial(async () => {
      await this.initialization;
      if (this.running && this.current.operation?.cancellable) return this.status();
      if (this.running) await this.running;
      const ownership = await this.tryAcquireCacheOwnership();
      if (!ownership) return this.status();
      try {
        await this.recoverCache(ownership);
        if (this.recoveryBlocked) return this.status();
        const previousResult = this.current.result;
        this.current = this.detectStatus();
        this.current.result = previousResult;
        if (this.current.state === "ready" && this.current.ownership === "harbor") {
          const latest = await this.resolveLatestVersion(this.platform, this.arch);
          if (latest && this.current.installed_version && versionNewer(latest, this.current.installed_version)) {
            this.current.state = "update_available";
            this.current.target_version = latest;
            this.current.available_actions = ["update", "repair", "recheck"];
          }
        }
        return this.status();
      } finally {
        await ownership.release();
      }
    });
  }

  async start(input: ManagedProviderOperationInput): Promise<ManagedProviderLifecycleCommandResult> {
    return this.serial(async () => {
      await this.initialization;
      if (this.recoveryBlocked) return this.rejected(recoveryError());
      if (this.running) return this.rejected(error("busy", "Another provider operation is already active.", true, ["recheck"]));
      const ownership = await this.tryAcquireCacheOwnership();
      if (!ownership) return this.rejected(this.recoveryBlocked ? recoveryError() : cacheBusyError());
      await this.recoverCache(ownership);
      if (this.recoveryBlocked) {
        await ownership.release();
        return this.rejected(recoveryError());
      }
      this.refreshDetection();
      const rejection = this.operationRejection(input);
      if (rejection) {
        await ownership.release();
        return this.rejected(rejection);
      }
      const before = this.beforeOperation();
      const operationId = `provider_operation_${randomUUID()}`;
      this.controller = new AbortController();
      this.activeOperationId = operationId;
      this.current = {
        ...this.current,
        state: "detecting",
        target_version: input.version ?? null,
        checked_at: this.timestamp(),
        operation: {
          operation_id: operationId,
          kind: input.operation,
          before_state: before.state,
          cancellable: true,
          cancel_requested: false,
          progress: progress("detecting", 0)
        },
        result: null,
        error: null,
        available_actions: ["cancel", "recheck"]
      };
      const signal = this.controller.signal;
      const running = this.runOperation(input, before, operationId, signal, ownership);
      this.running = running;
      void running.finally(() => {
        if (this.activeOperationId === operationId) {
          this.controller = null;
          this.running = null;
          this.activeOperationId = null;
        }
      }).catch(() => undefined);
      return { accepted: true, lifecycle: this.status() };
    });
  }

  async cancel(): Promise<ManagedProviderLifecycleCommandResult> {
    return this.serial(async () => {
      await this.initialization;
      if (this.recoveryBlocked) return this.rejected(recoveryError());
      const operationId = this.activeOperationId;
      if (!operationId || !this.running || !this.controller || !this.current.operation?.cancellable ||
          this.current.operation.operation_id !== operationId) {
        return this.rejected(error("not_cancellable", "The provider operation cannot be cancelled in its current phase.", true, ["recheck"]));
      }
      this.current.state = "cancelling";
      this.current.operation.cancel_requested = true;
      this.current.operation.cancellable = false;
      this.current.operation.progress.phase = "cancelling";
      this.current.checked_at = this.timestamp();
      this.controller.abort(new DOMException("The provider operation was cancelled.", "AbortError"));
      return { accepted: true, lifecycle: this.status() };
    });
  }

  async close(): Promise<void> {
    this.controller?.abort(new DOMException("Harbor Runtime is closing.", "AbortError"));
    await this.initialization;
    await this.running;
    await this.controlTail;
  }

  private async runOperation(
    input: ManagedProviderOperationInput,
    before: ManagedProviderBeforeOperation,
    operationId: string,
    signal: AbortSignal,
    ownership: ProviderCacheOwnership
  ): Promise<void> {
    let stagingDir = "";
    let journal: ProviderExchangeJournal | null = null;
    let integrityVerified = false;
    let launchVerified = false;
    let commitPersisted = false;
    try {
      const version = await this.targetVersion(input, before, signal);
      this.assertActive(operationId, signal);
      this.current.target_version = version;
      await mkdir(this.cacheDir, { recursive: true });
      stagingDir = join(this.cacheDir, `.harbor-staging-${operationId}`);
      const targetDir = join(this.cacheDir, `chromium-${version}`);
      const backupDir = join(this.cacheDir, `.harbor-backup-${operationId}`);
      const installed = await this.installRelease({
        version,
        platform: this.platform,
        arch: this.arch,
        destination_dir: stagingDir,
        signal,
        on_progress: (update) => this.updateReleaseProgress(operationId, update.phase, update.downloaded_bytes, update.total_bytes)
      });
      integrityVerified = true;
      this.assertActive(operationId, signal);
      const stagedRelative = relative(stagingDir, installed.binary_path);
      if (isAbsolute(stagedRelative) || stagedRelative === ".." || stagedRelative.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)) {
        throw new CloakBrowserReleaseError("install_failed", "The installed executable is outside the staging directory.");
      }
      this.setPhase(operationId, "launch_verifying", 4, true);
      const verification = await this.verifyLaunch(installed.binary_path, version, signal);
      this.assertActive(operationId, signal);
      if (!compatibleBrowserVersion(verification.browser_version, version)) {
        throw error("launch_verification_failed", "CloakBrowser reported a version outside the target compatibility range.", true, ["repair", "recheck"]);
      }
      launchVerified = true;
      this.setPhase(operationId, "installing", 4, true);
      journal = providerExchangeJournal(operationId, version, targetDir, stagingDir, backupDir, this.markerName(), before.version);
      await publishProviderExchange(this.cacheDir, journal, this.exchangeOperations, ownership, signal);
      const finalBinary = join(targetDir, stagedRelative);
      await access(finalBinary);
      this.assertActive(operationId, signal);
      await writeProviderVersionMarker(this.cacheDir, this.markerName(), version, ownership, signal);
      this.assertActive(operationId, signal);
      if (this.current.operation) this.current.operation.cancellable = false;
      journal.phase = "committed";
      await writeProviderExchangeJournal(this.cacheDir, journal, ownership);
      commitPersisted = true;
      await commitProviderExchange(this.cacheDir, journal, this.exchangeOperations, ownership);
      this.completeSuccess(operationId, version);
    } catch (cause) {
      const rollback = await attemptProviderRollback(
        this.cacheDir, journal, commitPersisted, ownership, this.exchangeOperations
      );
      const rolledBack = rollback.rolled_back;
      const rollbackFailure = rollback.failure;
      const recoveryFailed = commitPersisted || Boolean(journal) && !rolledBack;
      if (recoveryFailed) this.recoveryBlocked = true;
      if (this.isActive(operationId)) {
        this.current = settleProviderOperation({
          detected: this.detectStatus(), operation: this.current.operation, operation_id: operationId,
          phase: this.current.state, cause, cancelled: signal.aborted || this.cancelRequested(operationId),
          rolled_back: rolledBack, recovery_failed: recoveryFailed, integrity_verified: integrityVerified,
          launch_verified: launchVerified, rollback_failure: rollbackFailure, commit_persisted: commitPersisted
        });
      }
    } finally {
      if (stagingDir) await ownership.mutate(this.cacheDir, "operation:remove-staging", () =>
        rm(stagingDir, { recursive: true, force: true })).catch(() => undefined);
      await ownership.release();
    }
  }
  private async initializeCache(): Promise<void> {
    const ownership = await this.tryAcquireCacheOwnership();
    if (!ownership) return;
    try { await this.recoverCache(ownership); } finally { await ownership.release(); }
  }

  private async recoverCache(ownership: ProviderCacheOwnership): Promise<void> {
    try {
      const recovered = await recoverProviderExchange(this.cacheDir, ownership, this.exchangeOperations);
      await scavengeStaleProviderArtifacts(this.cacheDir, ownership, this.exchangeOperations);
      this.recoveryBlocked = false;
      if (recovered) this.current = this.detectStatus();
    } catch {
      this.recoveryBlocked = true;
      this.current = {
        ...this.detectStatus(),
        state: "repairable",
        error: recoveryError(),
        available_actions: ["recheck"]
      };
    }
  }

  private async tryAcquireCacheOwnership(): Promise<ProviderCacheOwnership | null> {
    try {
      return await this.acquireCacheOwnership(this.cacheDir);
    } catch (cause) {
      if (cause instanceof ProviderCacheOwnershipBusy) return null;
      this.recoveryBlocked = true;
      return null;
    }
  }

  private async targetVersion(input: ManagedProviderOperationInput, before: ManagedProviderBeforeOperation, signal: AbortSignal): Promise<string> {
    if (input.version) return input.version;
    if (input.operation === "repair" && before.version) return before.version;
    if (input.operation === "update") {
      const latest = await this.resolveLatestVersion(this.platform, this.arch, signal);
      if (latest) return latest;
      throw error("install_source_unavailable", "No signed CloakBrowser update is available for this platform.", true, ["retry", "recheck"]);
    }
    const version = defaultCloakBrowserVersion(this.platform, this.arch);
    if (!version) throw error("unsupported_platform", "Managed CloakBrowser is unsupported on this OS and architecture.", false, ["recheck"]);
    return version;
  }

  private operationRejection(input: ManagedProviderOperationInput): ManagedProviderLifecycleError | null {
    if (this.recoveryBlocked) return recoveryError();
    if (this.running || this.current.operation?.cancellable) return error("busy", "Another provider operation is already active.", true, ["recheck"]);
    if (this.current.ownership === "external_override") {
      return error("externally_managed", "The configured CloakBrowser binary is externally managed and will not be replaced by Harbor.", false, ["open_external_management", "recheck"]);
    }
    if (input.version && !isCloakBrowserVersion(input.version)) {
      return error("install_source_unavailable", "The requested CloakBrowser version is invalid.", false, ["recheck"]);
    }
    if (input.operation === "install" && (this.current.state === "ready" || this.current.state === "update_available")) {
      return error("already_ready", "CloakBrowser is already ready; use update or repair.", false, ["recheck"]);
    }
    if ((input.operation === "update" || input.operation === "repair") && this.current.state === "missing") {
      return error("not_installed", "CloakBrowser must be installed before it can be updated or repaired.", true, ["recheck"]);
    }
    return null;
  }

  private detectStatus(): ManagedProviderLifecycleStatus {
    const override = resolveCloakBrowserOverride(this.env);
    const detection: BrowserProviderDetectionInput = {
      env: { ...this.env, HARBOR_CLOAKBROWSER_PATH: override, CLOAKBROWSER_BINARY_PATH: override, CLOAKBROWSER_CACHE_DIR: this.cacheDir },
      platform: this.platform,
      arch: this.arch
    };
    const provider = detectBrowserProviders(detection).providers[0]!;
    const state = provider.install.status === "installed"
      ? provider.install.launchability === "launchable" ? "ready" : "damaged"
      : provider.install.status === "path_invalid" ? "damaged" : "missing";
    const ownership = override ? "external_override" : "harbor";
    return baseStatus(state, provider.install.version, ownership, cloakBrowserPlatformTag(this.platform, this.arch), this.timestamp());
  }

  private refreshDetection(): void {
    const result = this.current.result;
    const targetVersion = this.current.state === "update_available" ? this.current.target_version : null;
    this.current = this.detectStatus();
    this.current.result = result;
    if (targetVersion && this.current.state === "ready") {
      this.current.state = "update_available";
      this.current.target_version = targetVersion;
      this.current.available_actions = ["update", "repair", "recheck"];
    }
  }

  private beforeOperation(): ManagedProviderBeforeOperation {
    const detected = this.detectStatus();
    const state: ManagedProviderBeforeOperation["state"] = this.current.state === "update_available" && detected.state === "ready"
      ? "update_available" : detected.state === "ready" || detected.state === "damaged" ? detected.state : "missing";
    return { state, version: detected.installed_version };
  }

  private updateReleaseProgress(
    operationId: string,
    phase: "downloading" | "verifying" | "installing",
    downloaded: number,
    total: number | null
  ): void {
    if (!this.isActive(operationId) || !this.current.operation) return;
    const previous = this.current.operation.progress;
    const stableDownloaded = Math.max(previous.downloaded_bytes, downloaded);
    const percent = total ? Math.min(100, Math.floor(stableDownloaded / total * 100)) : previous.percent;
    this.current.state = phase;
    this.current.operation.cancellable = true;
    this.current.operation.progress = {
      phase,
      completed_steps: phase === "downloading"
        ? Math.max(1, previous.completed_steps)
        : phase === "verifying" ? Math.max(2, previous.completed_steps) : Math.max(3, previous.completed_steps),
      total_steps: 5,
      downloaded_bytes: stableDownloaded,
      total_bytes: total ?? previous.total_bytes,
      percent: previous.percent === null ? percent : percent === null ? previous.percent : Math.max(previous.percent, percent)
    };
    this.current.checked_at = this.timestamp();
  }

  private setPhase(operationId: string, phase: ManagedProviderLifecycleState, completedSteps: number, cancellable: boolean): void {
    if (!this.isActive(operationId) || !this.current.operation) return;
    this.current.state = phase;
    this.current.operation.cancellable = cancellable;
    this.current.operation.progress = {
      ...this.current.operation.progress,
      phase,
      completed_steps: Math.max(completedSteps, this.current.operation.progress.completed_steps),
      percent: completedSteps === 5 ? 100 : this.current.operation.progress.percent
    };
    this.current.checked_at = this.timestamp();
  }

  private markerName(): string {
    const tag = cloakBrowserPlatformTag(this.platform, this.arch);
    if (!tag) throw new CloakBrowserReleaseError("unsupported_platform", "Managed CloakBrowser is unsupported on this platform.");
    return `latest_version_${tag}`;
  }

  private completeSuccess(operationId: string, version: string): void {
    if (!this.isActive(operationId) || this.cancelRequested(operationId)) return;
    this.setPhase(operationId, "ready", 5, false);
    this.current.installed_version = version;
    this.current.result = result("succeeded", operationId, version, true, true, false);
    this.current.error = null;
    this.current.available_actions = ["update", "repair", "recheck"];
  }

  private assertActive(operationId: string, signal: AbortSignal): void {
    if (signal.aborted || this.cancelRequested(operationId)) throw signal.reason ?? new DOMException("The operation was aborted.", "AbortError");
    if (!this.isActive(operationId)) throw new Error("Provider operation is no longer active.");
  }

  private isActive(operationId: string): boolean {
    return this.activeOperationId === operationId && this.current.operation?.operation_id === operationId;
  }

  private cancelRequested(operationId: string): boolean {
    return this.current.operation?.operation_id === operationId && this.current.operation.cancel_requested;
  }

  private rejected(lifecycleError: ManagedProviderLifecycleError): ManagedProviderLifecycleCommandResult {
    return { accepted: false, lifecycle: this.status(), error: lifecycleError };
  }

  private serial<T>(action: () => Promise<T>): Promise<T> {
    const next = this.controlTail.then(action, action);
    this.controlTail = next.then(() => undefined, () => undefined);
    return next;
  }

  private timestamp(): string {
    return this.now().toISOString();
  }
}
