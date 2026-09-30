import { randomUUID } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { secureIdentityEnvironmentStoreFile, writeSecureJsonFile } from "./identity-environment-store.js";
import { validProxyServer } from "./identity-environment-configuration.js";

export const HARBOR_PROXY_REFERENCE_SCHEMA = "harbor-proxy-reference/v1" as const;
const STORE_SCHEMA = "harbor-proxy-reference-store/v1" as const;
const MAX_PROXY_REFERENCES = 128;
export type ProxyReferenceAvailability = "registered" | "revoked";
export type ProxyReferencePublicRecord = {
  schema_version: typeof HARBOR_PROXY_REFERENCE_SCHEMA;
  proxy_ref: string;
  label: string | null;
  registered_at: string;
  revoked_at: string | null;
  availability: ProxyReferenceAvailability;
};
type StoredProxyReference = Omit<ProxyReferencePublicRecord, "availability"> & { endpoint: string };
type ProxyReferenceStore = { schema_version: typeof STORE_SCHEMA; references: StoredProxyReference[] };

export class ProxyReferenceError extends Error {
  constructor(readonly code: "proxy_reference_invalid" | "proxy_reference_unavailable" | "proxy_reference_persistence_failed") { super(code); }
}

export function resolveProxyReferenceStorePath(identityEnvironmentPath?: string, homeDirectory = homedir()): string {
  return identityEnvironmentPath?.trim()
    ? `${identityEnvironmentPath.trim()}.proxy-references.json`
    : join(homeDirectory, ".webenvoy", "harbor", "proxy-references.json");
}

/** Owner-only reference directory. Endpoints are kept in a 0600 Harbor file and never projected. */
export class ProxyReferenceRegistry {
  private readonly references = new Map<string, StoredProxyReference>();
  private readonly persistenceUnavailable: boolean;

  constructor(private readonly path = resolveProxyReferenceStorePath()) {
    let unavailable = false;
    try { this.load(); } catch { unavailable = true; }
    this.persistenceUnavailable = unavailable;
  }

  register(endpoint: string, label?: string): ProxyReferencePublicRecord {
    this.requireAvailable();
    if (typeof endpoint !== "string" || !validProxyServer(endpoint) || label !== undefined &&
        (typeof label !== "string" || !label.trim() || label.length > 128 || /[\u0000-\u001f\u007f]/.test(label))) throw new ProxyReferenceError("proxy_reference_invalid");
    if (this.references.size >= MAX_PROXY_REFERENCES) throw new ProxyReferenceError("proxy_reference_invalid");
    const record: StoredProxyReference = {
      schema_version: HARBOR_PROXY_REFERENCE_SCHEMA,
      proxy_ref: `proxy-ref:${randomUUID()}`,
      label: label?.trim() ?? null,
      registered_at: new Date().toISOString(),
      revoked_at: null,
      endpoint
    };
    const next = new Map(this.references).set(record.proxy_ref, record);
    this.persist(next);
    this.references.clear();
    for (const [ref, entry] of next) this.references.set(ref, entry);
    return this.publicRecord(record);
  }

  list(): ProxyReferencePublicRecord[] { this.requireAvailable(); return [...this.references.values()].map(record => this.publicRecord(record)); }

  revoke(proxyRef: string): ProxyReferencePublicRecord {
    this.requireAvailable();
    const record = this.references.get(proxyRef);
    if (!record) throw new ProxyReferenceError("proxy_reference_unavailable");
    if (record.revoked_at) return this.publicRecord(record);
    const updated = { ...record, revoked_at: new Date().toISOString() };
    const next = new Map(this.references).set(proxyRef, updated);
    this.persist(next);
    this.references.clear();
    for (const [ref, entry] of next) this.references.set(ref, entry);
    return this.publicRecord(updated);
  }

  validate(proxyRef: string): "registered" | "unavailable" {
    if (this.persistenceUnavailable) return "unavailable";
    const record = this.references.get(proxyRef);
    if (!record || record.revoked_at || !validProxyServer(record.endpoint)) return "unavailable";
    return "registered";
  }

  resolve(proxyRef: string): string | null {
    if (this.persistenceUnavailable) return null;
    if (this.validate(proxyRef) !== "registered") return null;
    return this.references.get(proxyRef)!.endpoint;
  }

  private publicRecord(record: StoredProxyReference): ProxyReferencePublicRecord {
    const availability = record.revoked_at ? "revoked" : "registered";
    return { schema_version: record.schema_version, proxy_ref: record.proxy_ref, label: record.label,
      registered_at: record.registered_at, revoked_at: record.revoked_at, availability };
  }

  private load(): void {
    try {
      const entry = lstatSync(this.path);
      if (!entry.isFile() || entry.isSymbolicLink()) throw new Error("unsafe");
      secureIdentityEnvironmentStoreFile(this.path);
      const parsed = JSON.parse(readFileSync(this.path, "utf8")) as ProxyReferenceStore;
      if (!parsed || parsed.schema_version !== STORE_SCHEMA || Object.keys(parsed).some(key => !["schema_version", "references"].includes(key)) ||
          !Array.isArray(parsed.references) || parsed.references.length > MAX_PROXY_REFERENCES) throw new Error("invalid");
      for (const item of parsed.references) {
        if (!item || Object.keys(item).some(key => !["schema_version", "proxy_ref", "label", "registered_at", "revoked_at", "endpoint"].includes(key)) ||
            item.schema_version !== HARBOR_PROXY_REFERENCE_SCHEMA || !/^proxy-ref:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(item.proxy_ref) ||
            typeof item.endpoint !== "string" || !validProxyServer(item.endpoint) || !(item.label === null || typeof item.label === "string") ||
            !validTimestamp(item.registered_at) || !(item.revoked_at === null || validTimestamp(item.revoked_at))) throw new Error("invalid");
        if (this.references.has(item.proxy_ref)) throw new Error("duplicate");
        this.references.set(item.proxy_ref, item);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return;
      throw new ProxyReferenceError("proxy_reference_persistence_failed");
    }
  }

  private persist(references: Map<string, StoredProxyReference>): void {
    try { writeSecureJsonFile(this.path, { schema_version: STORE_SCHEMA, references: [...references.values()] } satisfies ProxyReferenceStore); }
    catch { throw new ProxyReferenceError("proxy_reference_persistence_failed"); }
  }

  private requireAvailable(): void {
    if (this.persistenceUnavailable) throw new ProxyReferenceError("proxy_reference_persistence_failed");
  }
}

function validTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}
