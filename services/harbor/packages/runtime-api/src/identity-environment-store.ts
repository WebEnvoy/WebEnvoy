import { chmodSync, closeSync, constants, fsyncSync, lstatSync, mkdirSync, openSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { LocalIdentityEnvironmentFacts } from "./identity-environment.js";
import type { StoredLocalIdentityEnvironmentRecord } from "./identity-environment-manager.js";

export function resolveIdentityEnvironmentStorePath(
  configuredPath: string | undefined,
  homeDirectory = homedir()
): string {
  return configuredPath?.trim() || join(homeDirectory, ".webenvoy", "harbor", "identity-environments.json");
}

export function secureIdentityEnvironmentStoreDirectory(path: string): void {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  const entry = lstatSync(path);
  if (!entry.isDirectory() || entry.isSymbolicLink()) throw new Error("Identity environment store directory must be a local directory.");
  chmodSync(path, 0o700);
}

export function secureIdentityEnvironmentStoreFile(path: string): void {
  const entry = lstatSync(path);
  if (!entry.isFile() || entry.isSymbolicLink()) throw new Error("Identity environment store must be a local file.");
  chmodSync(path, 0o600);
}

export function fsyncIdentityEnvironmentStoreDirectory(path: string): void {
  const fd = openSync(path, constants.O_RDONLY);
  try { fsyncSync(fd); } finally { closeSync(fd); }
}

export function replaceMap<K, V>(target: Map<K, V>, source: Map<K, V>): void {
  target.clear();
  for (const [key, value] of source) target.set(key, value);
}

export function internalIdentityEnvironmentFacts(record: StoredLocalIdentityEnvironmentRecord): LocalIdentityEnvironmentFacts {
  const facts = JSON.parse(JSON.stringify(record.identity_environment)) as LocalIdentityEnvironmentFacts;
  facts.browser_storage = {
    ...facts.browser_storage,
    profile_storage_ref: record.local_material_refs.profile_storage_ref
  };
  return facts;
}
