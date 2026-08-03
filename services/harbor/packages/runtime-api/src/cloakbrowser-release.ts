import { createHash, createPublicKey, randomUUID, verify as verifySignature } from "node:crypto";
import { createReadStream } from "node:fs";
import { access, chmod, open, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { extractCloakBrowserArchive, type CloakBrowserArchiveLimits } from "./cloakbrowser-archive.js";

export const CLOAKBROWSER_FREE_VERSIONS: Record<string, string> = {
  "linux-x64": "146.0.7680.177.5",
  "linux-arm64": "146.0.7680.177.3",
  "darwin-arm64": "145.0.7632.109.2",
  "darwin-x64": "145.0.7632.109.2",
  "windows-x64": "146.0.7680.177.5"
};

const CLOAKBROWSER_SIGNING_KEYS = ["MKFKwIhUcKWq5xTuNA0Ovg99njcDEcEJvmWYYhApvaU="];
const PRIMARY_RELEASE_BASE = "https://cloakbrowser.dev";
const FALLBACK_RELEASE_BASE = "https://github.com/CloakHQ/cloakbrowser/releases/download";
const GITHUB_RELEASES_API = "https://api.github.com/repos/CloakHQ/cloakbrowser/releases?per_page=10";
const VERSION_PATTERN = /^[0-9]+(?:\.[0-9]+){3,4}$/;
const ALLOWED_HTTPS_RELEASE_HOSTS = new Set([
  "cloakbrowser.dev",
  "api.github.com",
  "github.com",
  "release-assets.githubusercontent.com",
  "objects.githubusercontent.com"
]);

export interface CloakBrowserReleaseLimits extends CloakBrowserArchiveLimits {
  max_archive_bytes: number;
  max_manifest_bytes: number;
  max_signature_bytes: number;
  max_redirects: number;
}

export const DEFAULT_CLOAKBROWSER_RELEASE_LIMITS: CloakBrowserReleaseLimits = {
  max_archive_bytes: 768 * 1024 * 1024,
  max_manifest_bytes: 1024 * 1024,
  max_signature_bytes: 16 * 1024,
  max_redirects: 5,
  max_entries: 20_000,
  max_expanded_bytes: 3 * 1024 * 1024 * 1024
};

export type CloakBrowserReleasePhase = "downloading" | "verifying" | "installing";

export interface CloakBrowserReleaseProgress {
  phase: CloakBrowserReleasePhase;
  downloaded_bytes: number;
  total_bytes: number | null;
}

export interface InstallCloakBrowserReleaseInput {
  version: string;
  platform: NodeJS.Platform;
  arch: string;
  destination_dir: string;
  signal: AbortSignal;
  on_progress: (progress: CloakBrowserReleaseProgress) => void;
  fetch_impl?: typeof fetch;
  primary_release_base?: string;
  fallback_release_base?: string;
  signing_public_keys?: string[];
  release_limits?: Partial<CloakBrowserReleaseLimits>;
  allowed_insecure_release_hosts?: string[];
}

export interface InstalledCloakBrowserRelease {
  binary_path: string;
  integrity: "ed25519_sha256";
  source: "official_release";
}

export class CloakBrowserReleaseError extends Error {
  constructor(
    readonly code: "download_failed" | "integrity_check_failed" | "install_failed" | "unsupported_platform",
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = "CloakBrowserReleaseError";
  }
}

export function cloakBrowserPlatformTag(platform: NodeJS.Platform, arch: string): string | null {
  if (platform === "linux" && arch === "x64") return "linux-x64";
  if (platform === "linux" && arch === "arm64") return "linux-arm64";
  if (platform === "darwin" && arch === "arm64") return "darwin-arm64";
  if (platform === "darwin" && arch === "x64") return "darwin-x64";
  if (platform === "win32" && arch === "x64") return "windows-x64";
  return null;
}

export function cloakBrowserBinaryPath(platform: NodeJS.Platform, cacheDir: string, version: string): string {
  const dir = join(cacheDir, `chromium-${version}`);
  if (platform === "darwin") return join(dir, "Chromium.app", "Contents", "MacOS", "Chromium");
  if (platform === "win32") return join(dir, "chrome.exe");
  return join(dir, "chrome");
}

export function defaultCloakBrowserVersion(platform: NodeJS.Platform, arch: string): string | null {
  const tag = cloakBrowserPlatformTag(platform, arch);
  return tag ? CLOAKBROWSER_FREE_VERSIONS[tag] ?? null : null;
}

export function isCloakBrowserVersion(value: string): boolean {
  return VERSION_PATTERN.test(value);
}

export async function installCloakBrowserRelease(input: InstallCloakBrowserReleaseInput): Promise<InstalledCloakBrowserRelease> {
  const tag = cloakBrowserPlatformTag(input.platform, input.arch);
  if (!tag) throw new CloakBrowserReleaseError("unsupported_platform", "No managed CloakBrowser release exists for this OS and architecture.");
  if (!isCloakBrowserVersion(input.version)) throw new CloakBrowserReleaseError("install_failed", "The requested CloakBrowser version is invalid.");

  const archiveName = `cloakbrowser-${tag}${input.platform === "win32" ? ".zip" : ".tar.gz"}`;
  const primaryBase = input.primary_release_base ?? PRIMARY_RELEASE_BASE;
  const fallbackBase = input.fallback_release_base ?? FALLBACK_RELEASE_BASE;
  const releasePath = `chromium-v${input.version}`;
  const archivePath = join(dirname(input.destination_dir), `.harbor-download-${randomUUID()}${input.platform === "win32" ? ".zip" : ".tar.gz"}`);
  const fetchImpl = input.fetch_impl ?? fetch;
  const trust = releaseTrust(input);

  try {
    const downloadedFloor = await downloadWithFallback(
      [`${primaryBase}/${releasePath}/${archiveName}`, `${fallbackBase}/${releasePath}/${archiveName}`],
      archivePath,
      fetchImpl,
      input.signal,
      input.on_progress,
      trust
    );
    const manifest = await fetchSignedManifest([`${primaryBase}/${releasePath}`, `${fallbackBase}/${releasePath}`], fetchImpl, input.signal, trust);
    if (!manifest) throw new CloakBrowserReleaseError("integrity_check_failed", "The signed CloakBrowser release manifest is unavailable.");
    const archiveSize = (await stat(archivePath)).size;
    input.on_progress({
      phase: "verifying",
      downloaded_bytes: Math.max(downloadedFloor, archiveSize),
      total_bytes: downloadedFloor <= archiveSize ? archiveSize : null
    });
    await verifyCloakBrowserRelease(
      archivePath,
      archiveName,
      input.version,
      manifest.manifest,
      manifest.signature,
      input.signing_public_keys ?? CLOAKBROWSER_SIGNING_KEYS,
      input.signal
    );
    assertNotAborted(input.signal);
    input.on_progress({
      phase: "installing",
      downloaded_bytes: Math.max(downloadedFloor, archiveSize),
      total_bytes: downloadedFloor <= archiveSize ? archiveSize : null
    });
    try {
      await extractCloakBrowserArchive({
        archive_path: archivePath,
        destination_dir: input.destination_dir,
        platform: input.platform,
        signal: input.signal,
        limits: trust.limits
      });
    } catch (error) {
      if (input.signal.aborted) throw input.signal.reason ?? error;
      throw new CloakBrowserReleaseError("install_failed", "The verified CloakBrowser archive could not be installed.", { cause: error });
    }
    assertNotAborted(input.signal);
    const binaryPath = cloakBrowserBinaryPath(input.platform, dirname(input.destination_dir), input.version)
      .replace(join(dirname(input.destination_dir), `chromium-${input.version}`), input.destination_dir);
    await makeExecutable(binaryPath, input.platform);
    assertNotAborted(input.signal);
    return { binary_path: binaryPath, integrity: "ed25519_sha256", source: "official_release" };
  } finally {
    await rm(archivePath, { force: true });
  }
}

export async function latestCloakBrowserVersion(
  platform: NodeJS.Platform,
  arch: string,
  fetchImpl: typeof fetch = fetch,
  signal: AbortSignal = AbortSignal.timeout(10_000)
): Promise<string | null> {
  const tag = cloakBrowserPlatformTag(platform, arch);
  if (!tag) return null;
  const archiveName = `cloakbrowser-${tag}${platform === "win32" ? ".zip" : ".tar.gz"}`;
  try {
    const trust: ReleaseTrust = { limits: DEFAULT_CLOAKBROWSER_RELEASE_LIMITS, allowedInsecureHosts: new Set() };
    const response = await fetchTrusted(GITHUB_RELEASES_API, fetchImpl, signal, trust);
    if (!response.ok) return null;
    const releases = JSON.parse(new TextDecoder().decode(await readBoundedBody(response, 2 * 1024 * 1024, signal))) as
      Array<{ tag_name?: string; draft?: boolean; assets?: Array<{ name?: string }> }>;
    for (const release of releases) {
      const version = release.tag_name?.replace(/^chromium-v/, "") ?? "";
      if (!release.draft && isCloakBrowserVersion(version) && release.assets?.some((asset) => asset.name === archiveName)) return version;
    }
  } catch (error) {
    if (signal.aborted) throw signal.reason ?? error;
  }
  return null;
}

export async function verifyCloakBrowserRelease(
  archivePath: string,
  archiveName: string,
  version: string,
  manifest: Uint8Array,
  signatureText: Uint8Array,
  publicKeys: string[],
  signal: AbortSignal
): Promise<void> {
  assertNotAborted(signal);
  verifyManifestSignature(manifest, signatureText, publicKeys);
  const text = new TextDecoder().decode(manifest);
  if (text.split("\n").find((line) => line.startsWith("version="))?.slice(8).trim() !== version) {
    throw new CloakBrowserReleaseError("integrity_check_failed", "The signed CloakBrowser manifest does not match the requested version.");
  }
  const expected = parseChecksums(text).get(archiveName);
  if (!expected) throw new CloakBrowserReleaseError("integrity_check_failed", "The signed CloakBrowser manifest does not contain this platform archive.");
  const actual = await sha256File(archivePath, signal);
  if (actual !== expected) throw new CloakBrowserReleaseError("integrity_check_failed", "The CloakBrowser archive checksum does not match its signed manifest.");
}

function verifyManifestSignature(manifest: Uint8Array, signatureText: Uint8Array, publicKeys: string[]): void {
  const text = new TextDecoder().decode(signatureText).trim();
  const signature = Buffer.from(text, "base64");
  if (signature.toString("base64") !== text) throw new CloakBrowserReleaseError("integrity_check_failed", "The CloakBrowser manifest signature is malformed.");
  for (const encodedKey of publicKeys) {
    try {
      const key = createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: Buffer.from(encodedKey, "base64").toString("base64url") }, format: "jwk" });
      if (verifySignature(null, manifest, key, signature)) return;
    } catch {}
  }
  throw new CloakBrowserReleaseError("integrity_check_failed", "The CloakBrowser manifest signature could not be authenticated.");
}

function parseChecksums(manifest: string): Map<string, string> {
  const checksums = new Map<string, string>();
  for (const line of manifest.split("\n")) {
    const match = line.trim().match(/^([a-f0-9]{64})\s+\*?(.+)$/i);
    if (match) checksums.set(match[2]!, match[1]!.toLowerCase());
  }
  return checksums;
}

async function downloadWithFallback(
  urls: string[],
  destination: string,
  fetchImpl: typeof fetch,
  signal: AbortSignal,
  onProgress: (progress: CloakBrowserReleaseProgress) => void,
  trust: ReleaseTrust
): Promise<number> {
  let lastError: unknown;
  const tracker = { floor: 0 };
  for (const url of urls) {
    try {
      await downloadFile(url, destination, fetchImpl, signal, onProgress, trust, tracker);
      return tracker.floor;
    } catch (error) {
      if (signal.aborted) throw error;
      lastError = error;
      await rm(destination, { force: true });
    }
  }
  throw new CloakBrowserReleaseError("download_failed", "The official CloakBrowser release could not be downloaded.", { cause: lastError });
}

async function downloadFile(
  url: string,
  destination: string,
  fetchImpl: typeof fetch,
  signal: AbortSignal,
  onProgress: (progress: CloakBrowserReleaseProgress) => void,
  trust: ReleaseTrust,
  tracker: { floor: number }
): Promise<void> {
  const response = await fetchTrusted(url, fetchImpl, AbortSignal.any([signal, AbortSignal.timeout(600_000)]), trust);
  if (!response.ok || !response.body) throw new Error(`Download failed with HTTP ${response.status}.`);
  const total = Number(response.headers.get("content-length")) || null;
  if (total !== null && total > trust.limits.max_archive_bytes) throw new Error("Release archive exceeds the download byte limit.");
  const file = await open(destination, "w", 0o600);
  let downloaded = 0;
  try {
    for await (const chunk of response.body) {
      assertNotAborted(signal);
      const bytes = Buffer.from(chunk);
      downloaded += bytes.length;
      if (downloaded > trust.limits.max_archive_bytes) throw new Error("Release archive exceeds the download byte limit.");
      await file.write(bytes);
      tracker.floor = Math.max(tracker.floor, downloaded);
      onProgress({ phase: "downloading", downloaded_bytes: tracker.floor, total_bytes: total && total >= tracker.floor ? total : null });
    }
  } finally {
    await file.close();
  }
}

async function fetchSignedManifest(
  bases: string[],
  fetchImpl: typeof fetch,
  signal: AbortSignal,
  trust: ReleaseTrust
): Promise<{ manifest: Uint8Array; signature: Uint8Array } | null> {
  for (const base of bases) {
    try {
      const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(10_000)]);
      const [manifest, signature] = await Promise.all([
        fetchTrusted(`${base}/SHA256SUMS`, fetchImpl, requestSignal, trust),
        fetchTrusted(`${base}/SHA256SUMS.sig`, fetchImpl, requestSignal, trust)
      ]);
      if (manifest.ok && signature.ok) {
        return {
          manifest: await readBoundedBody(manifest, trust.limits.max_manifest_bytes, signal),
          signature: await readBoundedBody(signature, trust.limits.max_signature_bytes, signal)
        };
      }
    } catch (error) {
      if (signal.aborted) throw error;
    }
  }
  return null;
}

async function sha256File(filePath: string, signal: AbortSignal): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) {
    assertNotAborted(signal);
    hash.update(chunk);
  }
  return hash.digest("hex");
}

interface ReleaseTrust {
  limits: CloakBrowserReleaseLimits;
  allowedInsecureHosts: Set<string>;
}

function releaseTrust(input: InstallCloakBrowserReleaseInput): ReleaseTrust {
  const limits = { ...DEFAULT_CLOAKBROWSER_RELEASE_LIMITS, ...input.release_limits };
  for (const value of Object.values(limits)) {
    if (!Number.isSafeInteger(value) || value <= 0) throw new CloakBrowserReleaseError("install_failed", "Release limits must be positive integers.");
  }
  return { limits, allowedInsecureHosts: new Set(input.allowed_insecure_release_hosts ?? []) };
}

async function fetchTrusted(url: string, fetchImpl: typeof fetch, signal: AbortSignal, trust: ReleaseTrust): Promise<Response> {
  let current = new URL(url);
  for (let redirects = 0; ; redirects += 1) {
    assertTrustedUrl(current, trust);
    const response = await fetchImpl(current, { redirect: "manual", signal });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    if (redirects >= trust.limits.max_redirects) throw new Error("Release redirect limit exceeded.");
    const location = response.headers.get("location");
    if (!location) throw new Error("Release redirect is missing a location.");
    await response.body?.cancel();
    current = new URL(location, current);
  }
}

function assertTrustedUrl(url: URL, trust: ReleaseTrust): void {
  if (url.username || url.password) throw new Error("Authenticated release URLs are not allowed.");
  if (url.protocol === "https:" && ALLOWED_HTTPS_RELEASE_HOSTS.has(url.hostname)) return;
  if (url.protocol === "http:" && trust.allowedInsecureHosts.has(url.hostname)) return;
  throw new Error("Release URL is outside the approved HTTPS trust boundary.");
}

async function readBoundedBody(response: Response, maxBytes: number, signal: AbortSignal): Promise<Uint8Array> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw new Error("Release metadata exceeds its byte limit.");
  if (!response.body) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of response.body) {
    assertNotAborted(signal);
    const bytes = new Uint8Array(chunk);
    size += bytes.byteLength;
    if (size > maxBytes) throw new Error("Release metadata exceeds its byte limit.");
    chunks.push(bytes);
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
}

async function makeExecutable(binaryPath: string, platform: NodeJS.Platform): Promise<void> {
  try {
    if (platform !== "win32") await chmod(binaryPath, 0o755);
    await access(binaryPath);
  } catch (error) {
    throw new CloakBrowserReleaseError("install_failed", "The installed CloakBrowser executable is missing.", { cause: error });
  }
}

function assertNotAborted(signal: AbortSignal): void {
  if (signal.aborted) throw signal.reason ?? new DOMException("The operation was aborted.", "AbortError");
}
