import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import test from "node:test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ProxyReferenceError, ProxyReferenceRegistry } from "./proxy-reference.js";

test("stores owner proxy endpoints privately and exposes persistent opaque refs only", async () => {
  const directory = await mkdtemp(join(tmpdir(), "harbor-proxy-reference-"));
  const path = join(directory, "owner", "proxy-references.json");
  const endpoint = "socks5://127.0.0.1:1080";
  try {
    const registry = new ProxyReferenceRegistry(path);
    const registered = registry.register(endpoint, "Research proxy");
    assert.match(registered.proxy_ref, /^proxy-ref:[0-9a-f-]{36}$/);
    assert.equal(registered.availability, "registered");
    assert.equal("endpoint" in registered, false);
    assert.equal("expires_at" in registered, false);
    assert.equal(JSON.stringify(registered).includes(endpoint), false);

    const persisted = await readFile(path, "utf8");
    assert.equal(persisted.includes(endpoint), true, "the owner-only store retains the resolver input");
    assert.equal(JSON.parse(persisted).schema_version, "harbor-proxy-reference-store/v1");
    assert.equal((await stat(path)).mode & 0o777, 0o600, "proxy endpoint store must be owner-readable only");
    const reloaded = new ProxyReferenceRegistry(path);
    assert.equal(reloaded.validate(registered.proxy_ref), "registered");
    assert.equal(reloaded.resolve(registered.proxy_ref), endpoint);
    assert.equal(JSON.stringify(reloaded.list()).includes(endpoint), false);

    const revoked = reloaded.revoke(registered.proxy_ref);
    assert.equal(revoked.availability, "revoked");
    assert.equal(reloaded.validate(registered.proxy_ref), "unavailable");
    assert.equal(new ProxyReferenceRegistry(path).list()[0]?.availability, "revoked");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("rejects proxy URLs with embedded credentials or path data", async () => {
  const directory = await mkdtemp(join(tmpdir(), "harbor-proxy-reference-invalid-"));
  try {
    const registry = new ProxyReferenceRegistry(join(directory, "proxy-references.json"));
    for (const endpoint of ["http://user:password@127.0.0.1:8080", "http://127.0.0.1:8080/private", "file:///tmp/proxy"]) {
      assert.throws(() => registry.register(endpoint), (error: unknown) => error instanceof ProxyReferenceError && error.code === "proxy_reference_invalid");
    }
    assert.deepEqual(registry.list(), []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("keeps a corrupt optional proxy store local to proxy operations", async () => {
  const directory = await mkdtemp(join(tmpdir(), "harbor-proxy-reference-corrupt-"));
  const path = join(directory, "proxy-references.json");
  try {
    await writeFile(path, "not-json", { mode: 0o600 });
    const registry = new ProxyReferenceRegistry(path);
    assert.equal(registry.validate("proxy-ref:11111111-1111-4111-8111-111111111111"), "unavailable");
    assert.equal(registry.resolve("proxy-ref:11111111-1111-4111-8111-111111111111"), null);
    assert.throws(() => registry.list(), (error: unknown) => error instanceof ProxyReferenceError && error.code === "proxy_reference_persistence_failed");
    assert.throws(() => registry.register("http://127.0.0.1:8080"), (error: unknown) => error instanceof ProxyReferenceError && error.code === "proxy_reference_persistence_failed");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
