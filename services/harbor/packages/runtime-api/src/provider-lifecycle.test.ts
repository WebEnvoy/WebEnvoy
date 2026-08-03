import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { create as createTar } from "tar";
import {
  installCloakBrowserRelease,
  verifyCloakBrowserRelease,
  type InstallCloakBrowserReleaseInput
} from "./cloakbrowser-release.js";
import { createFixtureLauncher, HarborRuntime } from "./index.js";
import { ManagedProviderLifecycle, type ManagedProviderLifecycleStatus } from "./managed-provider-lifecycle.js";
import { verifyLocalProviderLaunch } from "./local-provider-launcher.js";
import { startHarborRuntimeServer } from "./server.js";

const fixtureVersion = "146.0.7680.177.5";
const archiveName = "cloakbrowser-linux-x64.tar.gz";

test("installs a signed local CloakBrowser release through Runtime API and verifies a real launch", async () => {
  const fixture = await createSignedReleaseFixture();
  const cacheDir = await mkdtemp(join(tmpdir(), "harbor-provider-cache-"));
  const untouchedProfiles = await mkdtemp(join(tmpdir(), "harbor-provider-profiles-"));
  await writeFile(join(untouchedProfiles, "sentinel"), "unchanged");
  const runtime = new HarborRuntime(createFixtureLauncher("ready"), {}, {
    cache_dir: cacheDir,
    env: {},
    platform: "linux",
    arch: "x64",
    install_release: (input) => installCloakBrowserRelease({
      ...input,
      primary_release_base: fixture.url,
      fallback_release_base: fixture.url,
      signing_public_keys: [fixture.publicKey],
      allowed_insecure_release_hosts: ["127.0.0.1"]
    }),
    resolve_latest_version: async () => fixtureVersion
  });
  const token = Buffer.alloc(32, 7).toString("base64url");
  const server = await startHarborRuntimeServer({ port: 0, runtime, manual_authentication_supervisor_token: token });
  try {
    const initial = await getJson(`${server.url}/runtime/browser-providers/cloakbrowser/lifecycle`);
    assert.equal(initial.state, "missing");
    assert.equal(initial.public_boundary.profile_storage, "isolated_temporary_only");
    assert.equal(initial.release_boundary.platform, "linux-x64");
    const catalog = await getJson(`${server.url}/runtime/browser-providers`);
    assert.equal(catalog.providers[0].download_guide.action, "managed_install");

    const unauthorized = await fetch(`${server.url}/runtime/browser-providers/cloakbrowser/lifecycle/operations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ operation: "install", version: fixtureVersion })
    });
    assert.equal(unauthorized.status, 403);
    assert.equal((await unauthorized.json()).failure_class, "manual_auth_authorization_required");

    const started = await postJson(
      `${server.url}/runtime/browser-providers/cloakbrowser/lifecycle/operations`,
      { operation: "install", version: fixtureVersion },
      token
    );
    assert.equal(started.status, 202);
    assert.equal(started.body.accepted, true);
    assert.equal(started.body.lifecycle.operation.before_state, "missing");

    const completed = await waitForLifecycle(server.url);
    assert.equal(completed.state, "ready");
    assert.equal(completed.installed_version, fixtureVersion);
    assert.equal(completed.result?.status, "succeeded");
    assert.equal(completed.result?.integrity_verified, true);
    assert.equal(completed.result?.launch_verified, true);
    assert.equal(completed.operation?.progress.completed_steps, 5);
    assert.equal(completed.operation?.cancellable, false);
    assert.equal(await readFile(join(untouchedProfiles, "sentinel"), "utf8"), "unchanged");
    assert.equal(JSON.stringify(completed).includes(cacheDir), false);
    assert.equal(JSON.stringify(completed).includes(fixture.archiveSha256), false);

    const lateCancel = await postEmpty(`${server.url}/runtime/browser-providers/cloakbrowser/lifecycle/cancel`, token);
    assert.equal(lateCancel.status, 409);
    assert.equal(lateCancel.body.error.code, "not_cancellable");

    const rechecked = await postEmpty(`${server.url}/runtime/browser-providers/cloakbrowser/lifecycle/recheck`, token);
    assert.equal(rechecked.status, 200);
    assert.equal(rechecked.body.state, "ready");
  } finally {
    await server.close();
    await fixture.close();
    await rm(cacheDir, { recursive: true, force: true });
    await rm(untouchedProfiles, { recursive: true, force: true });
  }
});

test("exposes stable cancellable progress and keeps the ready version on cancellation", async () => {
  const cacheDir = await installedCache("146.0.0.0", "old");
  let releaseDownload!: () => void;
  const downloadGate = new Promise<void>((resolve) => { releaseDownload = resolve; });
  const lifecycle = new ManagedProviderLifecycle({
    cache_dir: cacheDir,
    env: {},
    platform: "linux",
    arch: "x64",
    resolve_latest_version: async () => "147.0.0.0",
    install_release: async (input) => {
      input.on_progress({ phase: "downloading", downloaded_bytes: 5, total_bytes: 10 });
      await Promise.race([
        downloadGate,
        new Promise<never>((_resolve, reject) => input.signal.addEventListener("abort", () => reject(input.signal.reason), { once: true }))
      ]);
      throw new Error("unexpected release");
    },
    verify_launch: async (_path, version) => ({ browser_version: version })
  });
  try {
    const started = await lifecycle.start({ operation: "update" });
    assert.equal(started.accepted, true);
    await waitUntil(() => lifecycle.status().state === "downloading");
    const active = lifecycle.status();
    assert.equal(active.operation?.before_state, "ready");
    assert.equal(active.operation?.progress.percent, 50);
    assert.equal(active.operation?.cancellable, true);

    assert.equal((await lifecycle.cancel()).accepted, true);
    const completed = await waitForManager(lifecycle);
    assert.equal(completed.state, "ready");
    assert.equal(completed.installed_version, "146.0.0.0");
    assert.equal(completed.result?.status, "cancelled");
    assert.equal(await readFile(join(cacheDir, "chromium-146.0.0.0", "chrome"), "utf8"), "old");
  } finally {
    releaseDownload();
    await lifecycle.close();
    await rm(cacheDir, { recursive: true, force: true });
  }
});

test("keeps the published provider untouched when staging launch verification fails", async () => {
  const cacheDir = await installedCache("146.0.0.0", "old");
  const lifecycle = new ManagedProviderLifecycle({
    cache_dir: cacheDir,
    env: {},
    platform: "linux",
    arch: "x64",
    install_release: fakeInstaller("new"),
    verify_launch: async () => { throw new Error("CDP readiness failed"); }
  });
  try {
    assert.equal((await lifecycle.start({ operation: "repair" })).accepted, true);
    const completed = await waitForManager(lifecycle);
    assert.equal(completed.state, "ready");
    assert.equal(completed.result?.status, "failed");
    assert.equal(completed.result?.integrity_verified, true);
    assert.equal(completed.result?.launch_verified, false);
    assert.equal(completed.result?.rolled_back, false);
    assert.equal(completed.error?.code, "launch_verification_failed");
    assert.equal(await readFile(join(cacheDir, "chromium-146.0.0.0", "chrome"), "utf8"), "old");
  } finally {
    await lifecycle.close();
    await rm(cacheDir, { recursive: true, force: true });
  }
});

test("fails closed when a signed manifest checksum does not match the archive", async () => {
  const root = await mkdtemp(join(tmpdir(), "harbor-provider-integrity-"));
  const archivePath = join(root, archiveName);
  await writeFile(archivePath, "tampered");
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const manifest = Buffer.from(`version=${fixtureVersion}\n${"0".repeat(64)}  ${archiveName}\n`);
  const signature = Buffer.from(sign(null, manifest, privateKey).toString("base64"));
  const jwk = publicKey.export({ format: "jwk" });
  try {
    await assert.rejects(
      verifyCloakBrowserRelease(archivePath, archiveName, fixtureVersion, manifest, signature, [jwk.x!], new AbortController().signal),
      /checksum/
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("reports available updates and leaves explicit binary overrides externally managed", async () => {
  const cacheDir = await installedCache("146.0.0.0", "old");
  const lifecycle = new ManagedProviderLifecycle({
    cache_dir: cacheDir,
    env: {},
    platform: "linux",
    arch: "x64",
    resolve_latest_version: async () => "147.0.0.0",
    verify_launch: async (_path, version) => ({ browser_version: version })
  });
  let external: ManagedProviderLifecycle | null = null;
  try {
    const update = await lifecycle.recheck();
    assert.equal(update.state, "update_available");
    assert.equal(update.target_version, "147.0.0.0");
    assert.equal(update.available_actions.includes("update"), true);

    external = new ManagedProviderLifecycle({
      cache_dir: cacheDir,
      env: { HARBOR_CLOAKBROWSER_PATH: join(cacheDir, "chromium-146.0.0.0", "chrome") },
      platform: "linux",
      arch: "x64"
    });
    assert.equal(external.status().ownership, "external_override");
    const rejected = await external.start({ operation: "repair" });
    assert.equal(rejected.accepted, false);
    if (rejected.accepted) throw new Error("external provider operation should be rejected");
    assert.equal(rejected.error.code, "externally_managed");
  } finally {
    await lifecycle.close();
    await external?.close();
    await rm(cacheDir, { recursive: true, force: true });
  }
});

test("isolated launch verification rejects a real CDP readback with the wrong browser version", async () => {
  const root = await mkdtemp(join(tmpdir(), "harbor-provider-version-"));
  const browser = join(root, "chrome");
  await writeFakeBrowser(browser, "145.0.0.0");
  try {
    await assert.rejects(
      verifyLocalProviderLaunch(browser, { expected_version: fixtureVersion }),
      /does not match target/
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function createSignedReleaseFixture(): Promise<{
  url: string;
  publicKey: string;
  archiveSha256: string;
  close: () => Promise<void>;
}> {
  const root = await mkdtemp(join(tmpdir(), "harbor-provider-release-"));
  const source = join(root, "source");
  const archive = join(root, archiveName);
  await mkdir(source);
  await writeFakeBrowser(join(source, "chrome"));
  await createTar({ gzip: true, file: archive, cwd: source }, ["chrome"]);
  const archiveBytes = await readFile(archive);
  const archiveSha256 = createHash("sha256").update(archiveBytes).digest("hex");
  const manifest = Buffer.from(`version=${fixtureVersion}\n${archiveSha256}  ${archiveName}\n`);
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const signature = Buffer.from(sign(null, manifest, privateKey).toString("base64"));
  const server = createServer((request, response) => {
    const path = new URL(request.url ?? "/", "http://fixture.local").pathname;
    if (path.endsWith(`/${archiveName}`)) return send(response, archiveBytes, "application/gzip");
    if (path.endsWith("/SHA256SUMS")) return send(response, manifest, "text/plain");
    if (path.endsWith("/SHA256SUMS.sig")) return send(response, signature, "text/plain");
    response.writeHead(404).end();
  });
  await listen(server);
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("fixture server did not bind");
  const jwk = publicKey.export({ format: "jwk" });
  return {
    url: `http://127.0.0.1:${address.port}`,
    publicKey: jwk.x!,
    archiveSha256,
    close: async () => {
      await closeServer(server);
      await rm(root, { recursive: true, force: true });
    }
  };
}

async function writeFakeBrowser(path: string, browserVersion = "146.0.7680.177"): Promise<void> {
  await writeFile(path, `#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
const profile = process.argv.find((arg) => arg.startsWith("--user-data-dir="))?.slice(16);
if (!profile) process.exit(2);
mkdirSync(profile, { recursive: true });
const server = createServer((request, response) => {
  response.setHeader("content-type", "application/json");
  if (request.url === "/json/version") return response.end(JSON.stringify({ Browser: "Chrome/${browserVersion}", "Protocol-Version": "1.3" }));
  if (request.url === "/json/list") return response.end(JSON.stringify([{ type: "page", url: "about:blank", title: "Fixture" }]));
  response.writeHead(404).end("{}");
});
server.listen(0, "127.0.0.1", () => writeFileSync(join(profile, "DevToolsActivePort"), String(server.address().port) + "\\nfixture\\n"));
process.on("SIGTERM", () => server.close(() => process.exit(0)));
setInterval(() => {}, 10000);
`);
  await chmod(path, 0o755);
}

function fakeInstaller(contents: string): (input: InstallCloakBrowserReleaseInput) => Promise<{ binary_path: string; integrity: "ed25519_sha256"; source: "official_release" }> {
  return async (input) => {
    input.on_progress({ phase: "downloading", downloaded_bytes: 10, total_bytes: 10 });
    input.on_progress({ phase: "verifying", downloaded_bytes: 10, total_bytes: 10 });
    await mkdir(input.destination_dir, { recursive: true });
    const binaryPath = join(input.destination_dir, "chrome");
    await writeFile(binaryPath, contents, { mode: 0o755 });
    return { binary_path: binaryPath, integrity: "ed25519_sha256", source: "official_release" };
  };
}

async function installedCache(version: string, contents: string): Promise<string> {
  const cacheDir = await mkdtemp(join(tmpdir(), "harbor-provider-installed-"));
  const target = join(cacheDir, `chromium-${version}`);
  await mkdir(target);
  await writeFile(join(target, "chrome"), contents, { mode: 0o755 });
  await writeFile(join(cacheDir, "latest_version_linux-x64"), version);
  return cacheDir;
}

async function waitForLifecycle(url: string): Promise<ManagedProviderLifecycleStatus> {
  let status = await getJson(`${url}/runtime/browser-providers/cloakbrowser/lifecycle`) as ManagedProviderLifecycleStatus;
  for (let attempt = 0; attempt < 200 && ["detecting", "downloading", "verifying", "installing", "launch_verifying", "cancelling"].includes(status.state); attempt += 1) {
    await delay(20);
    status = await getJson(`${url}/runtime/browser-providers/cloakbrowser/lifecycle`) as ManagedProviderLifecycleStatus;
  }
  return status;
}

async function waitForManager(lifecycle: ManagedProviderLifecycle): Promise<ManagedProviderLifecycleStatus> {
  await waitUntil(() => !["detecting", "downloading", "verifying", "installing", "launch_verifying", "cancelling"].includes(lifecycle.status().state));
  return lifecycle.status();
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (predicate()) return;
    await delay(10);
  }
  throw new Error("timed out waiting for lifecycle state");
}

async function postJson(url: string, body: unknown, token: string): Promise<{ status: number; body: any }> {
  const response = await fetch(url, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "idempotency-key": `provider-test-${++requestSequence}` },
    body: JSON.stringify(body)
  });
  return { status: response.status, body: await response.json() };
}

async function postEmpty(url: string, token: string): Promise<{ status: number; body: any }> {
  const response = await fetch(url, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "idempotency-key": `provider-test-${++requestSequence}` },
    body: "{}"
  });
  return { status: response.status, body: await response.json() };
}

async function getJson(url: string): Promise<any> {
  const response = await fetch(url);
  assert.equal(response.status, 200);
  return response.json();
}

function send(response: import("node:http").ServerResponse, body: Buffer, contentType: string): void {
  response.writeHead(200, { "content-type": contentType, "content-length": body.length });
  response.end(body);
}

async function listen(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => server.close((cause) => cause ? reject(cause) : resolve()));
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

let requestSequence = 0;
