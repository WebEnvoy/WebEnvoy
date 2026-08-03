import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  acquireProviderCacheOwnership,
  ProviderCacheOwnershipLost
} from "./managed-provider-cache-ownership.js";
import {
  PROVIDER_EXCHANGE_JOURNAL,
  providerExchangeJournal,
  scavengeStaleProviderArtifacts,
  writeProviderExchangeJournal,
  writeProviderVersionMarker
} from "./managed-provider-exchange.js";
import { ManagedProviderLifecycle } from "./managed-provider-lifecycle.js";

const version = "146.0.7680.177.5";

test("ownership loss during pre-commit rollback always reaches a public terminal state", async (context) => {
  for (const mode of ["failure", "cancellation"] as const) {
    await context.test(mode, async () => {
      const cacheDir = await emptyCache();
      const paused = barrier();
      let acquisitions = 0;
      const managed = new ManagedProviderLifecycle({
        cache_dir: cacheDir,
        env: {},
        platform: "linux",
        arch: "x64",
        acquire_cache_ownership: async (path) => acquireProviderCacheOwnership(path, ++acquisitions === 2 ? {
          lease_duration_ms: 40,
          heartbeat_interval_ms: 0,
          on_before_mutation: async (label) => {
            if (label === "exchange:publish-target") await paused.wait();
          }
        } : {}),
        install_release: async (input) => {
          await mkdir(input.destination_dir, { recursive: true });
          const binaryPath = join(input.destination_dir, "chrome");
          await writeFile(binaryPath, "staged", { mode: 0o755 });
          return { binary_path: binaryPath, integrity: "ed25519_sha256", source: "official_release" };
        },
        verify_launch: async (_path, expected) => ({ browser_version: expected })
      });
      let successor: Awaited<ReturnType<typeof acquireProviderCacheOwnership>> | null = null;
      try {
        assert.equal((await managed.start({ operation: "install", version })).accepted, true);
        await paused.reached;
        assert.equal(managed.status().state, "installing");
        assert.equal(managed.status().result, null);
        if (mode === "cancellation") assert.equal((await managed.cancel()).accepted, true);
        await delayPastLease();
        successor = await acquireProviderCacheOwnership(cacheDir, { lease_duration_ms: 40 });
        const successorFile = join(cacheDir, "successor-owned");
        await successor.mutate(cacheDir, "test:create-successor-file", () => writeFile(successorFile, "keep"));
        paused.release();

        const completed = await waitForTerminal(managed);
        assert.equal(completed.state, "repairable");
        assert.equal(completed.result?.status, mode === "cancellation" ? "cancelled" : "failed");
        assert.equal(completed.error?.code, "recovery_failed");
        assert.equal(completed.operation?.cancellable, false);
        assert.match(completed.error?.message ?? "", mode === "cancellation" ? /Cancellation.*ownership was lost/ : /cache_ownership_lost.*ownership was lost/);
        assert.equal((await managed.cancel()).accepted, false);
        assert.equal(await readFile(successorFile, "utf8"), "keep");
        await access(join(cacheDir, PROVIDER_EXCHANGE_JOURNAL));
      } finally {
        paused.release();
        await successor?.release();
        await managed.close().catch(() => undefined);
        await rm(cacheDir, { recursive: true, force: true });
      }
    });
  }
});

test("journal and marker temporary writes stop at every fenced content mutation after takeover", async (context) => {
  const labels = [
    "journal:create-temporary",
    "journal:write-temporary",
    "journal:sync-temporary",
    "marker:create-temporary",
    "marker:write-temporary",
    "marker:sync-temporary"
  ] as const;
  for (const label of labels) {
    await context.test(label, async () => {
      const cacheDir = await emptyCache();
      const paused = barrier();
      const oldOwner = await acquireProviderCacheOwnership(cacheDir, {
        lease_duration_ms: 40,
        heartbeat_interval_ms: 0,
        on_before_mutation: async (current) => {
          if (current === label) await paused.wait();
        }
      });
      const journal = providerExchangeJournal(
        "temporary-fence-window",
        version,
        join(cacheDir, `chromium-${version}`),
        join(cacheDir, ".harbor-staging-temporary-fence-window"),
        join(cacheDir, ".harbor-backup-temporary-fence-window"),
        "latest_version_linux-x64",
        null
      );
      const mutation = label.startsWith("journal:")
        ? writeProviderExchangeJournal(cacheDir, journal, oldOwner)
        : writeProviderVersionMarker(cacheDir, "latest_version_linux-x64", version, oldOwner, new AbortController().signal);
      let successor: Awaited<ReturnType<typeof acquireProviderCacheOwnership>> | null = null;
      try {
        await paused.reached;
        const temporaryBeforeTakeover = (await readdir(cacheDir)).filter((name) => name.includes(".tmp-"));
        assert.equal(temporaryBeforeTakeover.length, label.endsWith("create-temporary") ? 0 : 1);
        await delayPastLease();
        successor = await acquireProviderCacheOwnership(cacheDir, { lease_duration_ms: 40 });
        const successorFile = join(cacheDir, "successor-owned");
        await successor.mutate(cacheDir, "test:create-successor-file", () => writeFile(successorFile, "keep"));
        await scavengeStaleProviderArtifacts(cacheDir, successor);
        paused.release();

        await assert.rejects(mutation, ProviderCacheOwnershipLost);
        assert.equal(await readFile(successorFile, "utf8"), "keep");
        assert.deepEqual((await readdir(cacheDir)).filter((name) => name.includes(".tmp-")), []);
      } finally {
        paused.release();
        await mutation.catch(() => undefined);
        await successor?.release();
        await oldOwner.release();
        await rm(cacheDir, { recursive: true, force: true });
      }
    });
  }
});

function emptyCache(): Promise<string> {
  return mkdtemp(join(tmpdir(), "harbor-provider-fencing-"));
}

function delayPastLease(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 80));
}

async function waitForTerminal(lifecycle: ManagedProviderLifecycle): Promise<ReturnType<ManagedProviderLifecycle["status"]>> {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const status = lifecycle.status();
    if (status.result) return status;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("timed out waiting for provider lifecycle terminal state");
}

function barrier(): { reached: Promise<void>; wait: () => Promise<void>; release: () => void } {
  let reached!: () => void;
  let release!: () => void;
  const reachedPromise = new Promise<void>((resolve) => { reached = resolve; });
  const released = new Promise<void>((resolve) => { release = resolve; });
  return {
    reached: reachedPromise,
    wait: async () => {
      reached();
      await released;
    },
    release
  };
}
