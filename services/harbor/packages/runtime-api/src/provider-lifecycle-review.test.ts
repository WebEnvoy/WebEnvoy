import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import test from "node:test";
import type { InstallCloakBrowserReleaseInput } from "./cloakbrowser-release.js";
import { acquireProviderCacheOwnership } from "./managed-provider-cache-ownership.js";
import {
  PROVIDER_EXCHANGE_JOURNAL,
  providerExchangeJournal,
  writeProviderExchangeJournal
} from "./managed-provider-exchange.js";
import { ManagedProviderLifecycle, type ManagedProviderLifecycleStatus } from "./managed-provider-lifecycle.js";
import { detectBrowserProviders } from "./provider-management.js";

const version = "146.0.7680.177.5";
const activeStates = ["detecting", "downloading", "verifying", "installing", "launch_verifying", "cancelling"];

test("accepted cancellation during staging launch verification always terminates as cancelled", async () => {
  const cacheDir = await emptyCache();
  let verificationStarted!: () => void;
  const started = new Promise<void>((resolve) => { verificationStarted = resolve; });
  const lifecycle = new ManagedProviderLifecycle({
    cache_dir: cacheDir,
    env: {},
    platform: "linux",
    arch: "x64",
    install_release: fakeInstaller("new"),
    verify_launch: async (_path, _version, signal) => {
      verificationStarted();
      await new Promise<never>((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
      throw new Error("unreachable");
    }
  });
  try {
    assert.equal((await lifecycle.start({ operation: "install", version })).accepted, true);
    await started;
    assert.equal((await lifecycle.cancel()).accepted, true);
    const completed = await waitForManager(lifecycle);
    assert.equal(completed.result?.status, "cancelled");
    assert.notEqual(completed.result?.status, "succeeded");
    assert.equal(completed.state, "missing");
    await assert.rejects(access(join(cacheDir, `chromium-${version}`)));
  } finally {
    await lifecycle.close();
    await rm(cacheDir, { recursive: true, force: true });
  }
});

test("accepted cancellation during unpack observes the shared signal", async () => {
  const cacheDir = await emptyCache();
  let unpackStarted!: () => void;
  const entered = new Promise<void>((resolve) => { unpackStarted = resolve; });
  const lifecycle = new ManagedProviderLifecycle({
    cache_dir: cacheDir,
    env: {},
    platform: "linux",
    arch: "x64",
    install_release: async (input) => {
      input.on_progress({ phase: "installing", downloaded_bytes: 10, total_bytes: 10 });
      unpackStarted();
      await new Promise<never>((_resolve, reject) => input.signal.addEventListener("abort", () => reject(input.signal.reason), { once: true }));
      throw new Error("unreachable");
    },
    verify_launch: async (_path, expected) => ({ browser_version: expected })
  });
  try {
    await lifecycle.start({ operation: "install", version });
    await entered;
    assert.equal(lifecycle.status().state, "installing");
    assert.equal((await lifecycle.cancel()).accepted, true);
    assert.equal((await waitForManager(lifecycle)).result?.status, "cancelled");
  } finally {
    await lifecycle.close();
    await rm(cacheDir, { recursive: true, force: true });
  }
});

test("verifies staging and compatible browser version before publishing", async () => {
  const cacheDir = await installedCache("old");
  let verifiedPath = "";
  const lifecycle = new ManagedProviderLifecycle({
    cache_dir: cacheDir,
    env: {},
    platform: "linux",
    arch: "x64",
    install_release: fakeInstaller("new"),
    verify_launch: async (path) => {
      verifiedPath = path;
      assert.match(path, /\.harbor-staging-/);
      assert.equal(await readFile(join(cacheDir, `chromium-${version}`, "chrome"), "utf8"), "old");
      return { browser_version: "146.0.7680.177" };
    }
  });
  try {
    await lifecycle.start({ operation: "repair" });
    const completed = await waitForManager(lifecycle);
    assert.match(verifiedPath, /\.harbor-staging-/);
    assert.equal(completed.result?.status, "succeeded");
    assert.equal(await readFile(join(cacheDir, `chromium-${version}`, "chrome"), "utf8"), "new");
  } finally {
    await lifecycle.close();
    await rm(cacheDir, { recursive: true, force: true });
  }
});

test("rejects an observed browser version outside the target range before marker write", async () => {
  const cacheDir = await installedCache("old");
  const lifecycle = new ManagedProviderLifecycle({
    cache_dir: cacheDir,
    env: {},
    platform: "linux",
    arch: "x64",
    install_release: fakeInstaller("new"),
    verify_launch: async () => ({ browser_version: "145.0.0.0" })
  });
  try {
    await lifecycle.start({ operation: "repair" });
    const completed = await waitForManager(lifecycle);
    assert.equal(completed.result?.status, "failed");
    assert.equal(completed.error?.code, "launch_verification_failed");
    assert.equal(await readFile(join(cacheDir, `chromium-${version}`, "chrome"), "utf8"), "old");
    assert.equal(await readFile(join(cacheDir, "latest_version_linux-x64"), "utf8"), version);
  } finally {
    await lifecycle.close();
    await rm(cacheDir, { recursive: true, force: true });
  }
});

test("recovers a crashed target publication from the durable exchange journal", async () => {
  const cacheDir = await installedCache("old");
  const target = join(cacheDir, `chromium-${version}`);
  const staging = join(cacheDir, ".harbor-staging-crash");
  const backup = join(cacheDir, ".harbor-backup-crash");
  await rename(target, backup);
  await mkdir(target);
  await writeFile(join(target, "chrome"), "new");
  await writeFile(join(cacheDir, "latest_version_linux-x64"), "147.0.0.0");
  const journal = providerExchangeJournal("crash", version, target, staging, backup, "latest_version_linux-x64", version);
  journal.phase = "target_published";
  await writeJournal(cacheDir, journal);
  const lifecycle = new ManagedProviderLifecycle({ cache_dir: cacheDir, env: {}, platform: "linux", arch: "x64" });
  try {
    const status = await lifecycle.recheck();
    assert.equal(status.state, "ready");
    assert.equal(await readFile(join(target, "chrome"), "utf8"), "old");
    assert.equal(await readFile(join(cacheDir, "latest_version_linux-x64"), "utf8"), version);
    await assert.rejects(access(backup));
    await assert.rejects(access(join(cacheDir, PROVIDER_EXCHANGE_JOURNAL)));
  } finally {
    await lifecycle.close();
    await rm(cacheDir, { recursive: true, force: true });
  }
});

test("a new mutation recovers an existing journal before creating its exchange", async () => {
  const cacheDir = await installedCache("old");
  const target = join(cacheDir, `chromium-${version}`);
  const staging = join(cacheDir, ".harbor-staging-stale");
  const backup = join(cacheDir, ".harbor-backup-stale");
  const lifecycle = new ManagedProviderLifecycle({
    cache_dir: cacheDir,
    env: {},
    platform: "linux",
    arch: "x64",
    install_release: fakeInstaller("replacement"),
    verify_launch: async (_path, expected) => {
      assert.equal(await readFile(join(target, "chrome"), "utf8"), "old");
      return { browser_version: expected };
    }
  });
  try {
    await lifecycle.recheck();
    await rename(target, backup);
    await mkdir(target);
    await writeFile(join(target, "chrome"), "interrupted");
    const journal = providerExchangeJournal("stale", version, target, staging, backup, "latest_version_linux-x64", version);
    journal.phase = "target_published";
    await writeJournal(cacheDir, journal);
    assert.equal((await lifecycle.start({ operation: "repair" })).accepted, true);
    assert.equal((await waitForManager(lifecycle)).result?.status, "succeeded");
    assert.equal(await readFile(join(target, "chrome"), "utf8"), "replacement");
    await assert.rejects(access(join(cacheDir, PROVIDER_EXCHANGE_JOURNAL)));
  } finally {
    await lifecycle.close();
    await rm(cacheDir, { recursive: true, force: true });
  }
});

test("preserves backup and a recoverable error when rollback cannot restore it", async () => {
  const cacheDir = await installedCache("old");
  let recoveryBlocked = true;
  const lifecycle = new ManagedProviderLifecycle({
    cache_dir: cacheDir,
    env: {},
    platform: "linux",
    arch: "x64",
    install_release: fakeInstaller("new"),
    verify_launch: async (_path, expected) => ({ browser_version: expected }),
    exchange_file_operations: {
      rename: async (source, destination) => {
        if (basename(String(source)).startsWith(".harbor-staging-")) {
          await rename(source, destination);
          throw new Error("injected failure after target publication");
        }
        if (basename(String(source)).startsWith(".harbor-backup-") && basename(String(destination)).startsWith("chromium-")) {
          if (recoveryBlocked) throw new Error("injected rollback rename failure");
        }
        await rename(source, destination);
      },
      rm
    }
  });
  try {
    await lifecycle.start({ operation: "repair" });
    const completed = await waitForManager(lifecycle);
    assert.equal(completed.result?.status, "failed");
    assert.equal(completed.result?.rolled_back, false);
    assert.equal(completed.error?.code, "recovery_failed");
    assert.deepEqual(completed.available_actions, ["recheck"]);
    const backupName = (await readdir(cacheDir)).find((entry) => entry.startsWith(".harbor-backup-"));
    assert.ok(backupName);
    await access(join(cacheDir, PROVIDER_EXCHANGE_JOURNAL));
    const repair = await lifecycle.start({ operation: "repair" });
    assert.equal(repair.accepted, false);
    assert.equal(repair.error?.code, "recovery_failed");
    assert.equal((await readdir(cacheDir)).filter((entry) => entry.startsWith(".harbor-backup-")).length, 1);
    recoveryBlocked = false;
    assert.equal((await lifecycle.recheck()).state, "ready");
    assert.equal(await readFile(join(cacheDir, `chromium-${version}`, "chrome"), "utf8"), "old");
    await assert.rejects(access(join(cacheDir, PROVIDER_EXCHANGE_JOURNAL)));
  } finally {
    await lifecycle.close();
    await rm(cacheDir, { recursive: true, force: true });
  }
});

test("successful commit removes all superseded managed versions", async () => {
  const cacheDir = await installedCache("old");
  const staleVersion = "145.0.0.0";
  const nextVersion = "147.0.0.0";
  await mkdir(join(cacheDir, `chromium-${staleVersion}`));
  await writeFile(join(cacheDir, `chromium-${staleVersion}`, "chrome"), "stale");
  const lifecycle = new ManagedProviderLifecycle({
    cache_dir: cacheDir,
    env: {},
    platform: "linux",
    arch: "x64",
    install_release: fakeInstaller("new"),
    verify_launch: async (_path, expected) => ({ browser_version: expected })
  });
  try {
    assert.equal((await lifecycle.start({ operation: "update", version: nextVersion })).accepted, true);
    assert.equal((await waitForManager(lifecycle)).result?.status, "succeeded");
    assert.deepEqual(
      (await readdir(cacheDir)).filter((entry) => entry.startsWith("chromium-")).sort(),
      [`chromium-${nextVersion}`]
    );
  } finally {
    await lifecycle.close();
    await rm(cacheDir, { recursive: true, force: true });
  }
});

test("committed cleanup failure keeps the journal-required backup until recheck", async () => {
  const cacheDir = await installedCache("old");
  const staleVersion = "145.0.0.0";
  await mkdir(join(cacheDir, `chromium-${staleVersion}`));
  let cleanupBlocked = true;
  const lifecycle = new ManagedProviderLifecycle({
    cache_dir: cacheDir,
    env: {},
    platform: "linux",
    arch: "x64",
    install_release: fakeInstaller("new"),
    verify_launch: async (_path, expected) => ({ browser_version: expected }),
    exchange_file_operations: {
      rename,
      rm: async (path, options) => {
        if (cleanupBlocked && basename(String(path)) === `chromium-${staleVersion}`) throw new Error("injected old-version cleanup failure");
        await rm(path, options);
      }
    }
  });
  try {
    await lifecycle.start({ operation: "repair" });
    const failed = await waitForManager(lifecycle);
    assert.equal(failed.error?.code, "recovery_failed");
    assert.ok((await readdir(cacheDir)).some((entry) => entry.startsWith(".harbor-backup-")));
    await access(join(cacheDir, PROVIDER_EXCHANGE_JOURNAL));
    cleanupBlocked = false;
    assert.equal((await lifecycle.recheck()).state, "ready");
    assert.equal((await readdir(cacheDir)).some((entry) => entry.startsWith(".harbor-backup-")), false);
    await assert.rejects(access(join(cacheDir, PROVIDER_EXCHANGE_JOURNAL)));
  } finally {
    await lifecycle.close();
    await rm(cacheDir, { recursive: true, force: true });
  }
});

test("terminal commit cleanup keeps recheck waiting and concurrent repair excluded", async () => {
  const cacheDir = await installedCache("old");
  let cleanupEntered!: () => void;
  let releaseCleanup!: () => void;
  const entered = new Promise<void>((resolve) => { cleanupEntered = resolve; });
  const gate = new Promise<void>((resolve) => { releaseCleanup = resolve; });
  const first = new ManagedProviderLifecycle({
    cache_dir: cacheDir,
    env: {},
    platform: "linux",
    arch: "x64",
    install_release: fakeInstaller("new"),
    resolve_latest_version: async () => version,
    verify_launch: async (_path, expected) => ({ browser_version: expected }),
    exchange_file_operations: {
      rename,
      rm: async (path, options) => {
        if (basename(String(path)).startsWith(".harbor-backup-")) {
          cleanupEntered();
          await gate;
        }
        await rm(path, options);
      }
    }
  });
  const second = new ManagedProviderLifecycle({
    cache_dir: cacheDir,
    env: {},
    platform: "linux",
    arch: "x64",
    resolve_latest_version: async () => version
  });
  try {
    await first.recheck();
    await second.recheck();
    assert.equal((await first.start({ operation: "repair" })).accepted, true);
    await entered;
    assert.equal(first.status().operation?.cancellable, false);
    let recheckResolved = false;
    const recheck = first.recheck().then((status) => {
      recheckResolved = true;
      return status;
    });
    const repair = await second.start({ operation: "repair" });
    assert.equal(repair.accepted, false);
    assert.equal(repair.error?.code, "busy");
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(recheckResolved, false);
    releaseCleanup();
    assert.equal((await recheck).state, "ready");
    assert.equal((await waitForManager(first)).result?.status, "succeeded");
  } finally {
    releaseCleanup();
    await first.close();
    await second.close();
    await rm(cacheDir, { recursive: true, force: true });
  }
});

test("recheck and cancel serialize without overwriting an active operation", async () => {
  const cacheDir = await emptyCache();
  let verificationStarted!: () => void;
  let releaseVerification!: () => void;
  const entered = new Promise<void>((resolve) => { verificationStarted = resolve; });
  const gate = new Promise<void>((resolve) => { releaseVerification = resolve; });
  const lifecycle = new ManagedProviderLifecycle({
    cache_dir: cacheDir,
    env: {},
    platform: "linux",
    arch: "x64",
    install_release: fakeInstaller("new"),
    verify_launch: async (_path, expected) => {
      verificationStarted();
      await gate;
      return { browser_version: expected };
    }
  });
  try {
    await lifecycle.start({ operation: "install", version });
    await entered;
    const recheck = lifecycle.recheck();
    const cancel = lifecycle.cancel();
    assert.equal((await recheck).state, "launch_verifying");
    assert.equal((await cancel).accepted, true);
    releaseVerification();
    const completed = await waitForManager(lifecycle);
    assert.equal(completed.result?.status, "cancelled");
  } finally {
    releaseVerification();
    await lifecycle.close();
    await rm(cacheDir, { recursive: true, force: true });
  }
});

test("progress bytes and percent remain monotonic across verification", async () => {
  const cacheDir = await emptyCache();
  const observations: Array<{ bytes: number; percent: number | null }> = [];
  let lifecycle!: ManagedProviderLifecycle;
  lifecycle = new ManagedProviderLifecycle({
    cache_dir: cacheDir,
    env: {},
    platform: "linux",
    arch: "x64",
    install_release: async (input) => {
      for (const update of [
        { phase: "downloading" as const, downloaded_bytes: 80, total_bytes: 100 },
        { phase: "verifying" as const, downloaded_bytes: 0, total_bytes: null }
      ]) {
        input.on_progress(update);
        const current = lifecycle.status().operation!.progress;
        observations.push({ bytes: current.downloaded_bytes, percent: current.percent });
      }
      return writeStagingBinary(input, "new");
    },
    verify_launch: async (_path, expected) => ({ browser_version: expected })
  });
  try {
    await lifecycle.start({ operation: "install", version });
    assert.equal((await waitForManager(lifecycle)).result?.status, "succeeded");
    assert.deepEqual(observations, [{ bytes: 80, percent: 80 }, { bytes: 80, percent: 80 }]);
  } finally {
    await lifecycle.close();
    await rm(cacheDir, { recursive: true, force: true });
  }
});

test("external override remains external and exposes no managed action", async () => {
  const cacheDir = await installedCache("old");
  const override = join(cacheDir, `chromium-${version}`, "chrome");
  const env = { HARBOR_CLOAKBROWSER_PATH: "", CLOAKBROWSER_BINARY_PATH: override };
  const lifecycle = new ManagedProviderLifecycle({
    cache_dir: cacheDir,
    env,
    platform: "linux",
    arch: "x64"
  });
  try {
    const status = await lifecycle.recheck();
    assert.equal(status.management_mode, "external");
    assert.equal(status.ownership, "external_override");
    assert.deepEqual(status.available_actions, ["recheck", "open_external_management"]);
    const catalog = detectBrowserProviders({
      env,
      platform: "linux",
      arch: "x64"
    });
    assert.equal(catalog.providers[0]?.management_mode, "external");
    assert.equal(catalog.providers[0]?.install.path, override);
    assert.equal(catalog.providers[0]?.download_guide.action, "external_management");
  } finally {
    await lifecycle.close();
    await rm(cacheDir, { recursive: true, force: true });
  }
});

function fakeInstaller(contents: string): (input: InstallCloakBrowserReleaseInput) => Promise<{ binary_path: string; integrity: "ed25519_sha256"; source: "official_release" }> {
  return async (input) => {
    input.on_progress({ phase: "downloading", downloaded_bytes: 10, total_bytes: 10 });
    input.on_progress({ phase: "verifying", downloaded_bytes: 10, total_bytes: 10 });
    return writeStagingBinary(input, contents);
  };
}

async function writeStagingBinary(input: InstallCloakBrowserReleaseInput, contents: string) {
  await mkdir(input.destination_dir, { recursive: true });
  const binaryPath = join(input.destination_dir, "chrome");
  await writeFile(binaryPath, contents, { mode: 0o755 });
  return { binary_path: binaryPath, integrity: "ed25519_sha256" as const, source: "official_release" as const };
}

async function emptyCache(): Promise<string> {
  return mkdtemp(join(tmpdir(), "harbor-provider-review-"));
}

async function installedCache(contents: string): Promise<string> {
  const cacheDir = await emptyCache();
  const target = join(cacheDir, `chromium-${version}`);
  await mkdir(target);
  await writeFile(join(target, "chrome"), contents, { mode: 0o755 });
  await writeFile(join(cacheDir, "latest_version_linux-x64"), version);
  return cacheDir;
}

async function waitForManager(lifecycle: ManagedProviderLifecycle): Promise<ManagedProviderLifecycleStatus> {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const status = lifecycle.status();
    if (!activeStates.includes(status.state)) return status;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("timed out waiting for provider operation");
}

async function writeJournal(cacheDir: string, journal: ReturnType<typeof providerExchangeJournal>): Promise<void> {
  const ownership = await acquireProviderCacheOwnership(cacheDir);
  try { await writeProviderExchangeJournal(cacheDir, journal, ownership); } finally { await ownership.release(); }
}
