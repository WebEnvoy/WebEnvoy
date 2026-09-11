import assert from "node:assert/strict";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { BrowserProviderPreferenceManager } from "./provider-preference.js";

const cloakPath = "/Users/test/.cloakbrowser/chromium-145.0.7632.109.2/Chromium.app/Contents/MacOS/Chromium";
const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const available = {
  platform: "darwin" as const,
  arch: "arm64",
  home_dir: "/Users/test",
  env: {},
  path_exists: (path: string) => path === cloakPath || path === chromePath,
  is_executable: (path: string) => path === cloakPath || path === chromePath,
  read_text: () => null,
};

test("persists an explicit creation default without conflating the project recommendation", () => {
  const directory = mkdtempSync(join(tmpdir(), "harbor-provider-preference-"));
  const persistence_path = join(directory, "preference.json");
  try {
    const manager = new BrowserProviderPreferenceManager({ persistence_path, provider_detection: available });
    const initial = manager.read();
    assert.equal(initial.project_recommendation.provider_id, "cloakbrowser");
    assert.equal(initial.user_creation_default.availability, "unset");

    const set = manager.mutate({ operation: "set", idempotency_key: "set-default", provider_id: "chrome_official" });
    assert.equal(set.status, "completed");
    assert.equal(set.preference.user_creation_default.provider_id, "chrome_official");
    assert.equal(statSync(persistence_path).mode & 0o777, 0o600);
    assert.deepEqual(manager.mutate({ operation: "set", idempotency_key: "set-default", provider_id: "chrome_official" }), set);
    assert.equal(manager.mutate({ operation: "clear", idempotency_key: "set-default" }).failure?.code, "idempotency_conflict");

    const reloaded = new BrowserProviderPreferenceManager({ persistence_path, provider_detection: available });
    assert.equal(reloaded.read().user_creation_default.provider_id, "chrome_official");
    assert.equal(reloaded.mutationResult("set-default")?.status, "completed");
    assert.equal(reloaded.mutate({ operation: "clear", idempotency_key: "clear-default" }).status, "completed");
    assert.equal(reloaded.read().user_creation_default.availability, "unset");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("rejects an unavailable replacement and preserves a saved value that later becomes unavailable", () => {
  const directory = mkdtempSync(join(tmpdir(), "harbor-provider-preference-"));
  const persistence_path = join(directory, "preference.json");
  try {
    const manager = new BrowserProviderPreferenceManager({ persistence_path, provider_detection: available });
    manager.mutate({ operation: "set", idempotency_key: "set-cloak", provider_id: "cloakbrowser" });
    const unavailable = new BrowserProviderPreferenceManager({
      persistence_path,
      provider_detection: { ...available, path_exists: () => false, is_executable: () => false },
    });
    assert.equal(unavailable.read().user_creation_default.provider_id, "cloakbrowser");
    assert.equal(unavailable.read().user_creation_default.availability, "unavailable");
    const rejected = unavailable.mutate({ operation: "set", idempotency_key: "replace", provider_id: "chrome_official" });
    assert.equal(rejected.failure?.code, "provider_unavailable");
    assert.deepEqual(unavailable.mutate({ operation: "set", idempotency_key: "replace", provider_id: "chrome_official" }), rejected);
    assert.deepEqual(unavailable.mutationResult("replace"), rejected);
    assert.equal(unavailable.read().user_creation_default.provider_id, "cloakbrowser");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
