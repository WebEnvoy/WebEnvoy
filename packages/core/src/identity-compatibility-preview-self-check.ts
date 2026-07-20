import assert from "node:assert/strict";

import type { HarborIdentityEnvironmentFacts } from "./harbor-admission.js";
import {
  createHttpHarborIdentityFactsReader,
  identityCompatibilityPreviewRequestSchemaVersion,
  previewIdentityCompatibility,
  type HarborIdentityFactsReader,
  type IdentityCompatibilityPreviewRequest
} from "./identity-compatibility-preview.js";
import type { LodePackageAdmissionContract } from "./lode-admission.js";

const packageRef = "lode://site-capability/xiaohongshu/search-notes@0.1.0";
const lockRef = "lode://lock/site-capability/xiaohongshu/search-notes@0.1.0";
const now = new Date("2026-07-21T08:00:00.000Z");
const providerStatus = {
  schema_version: "harbor-browser-provider-status/v0" as const,
  providers: [{ provider_id: "cloakbrowser", install: { status: "installed", launchability: "launchable" } }]
};

function packageContract(freshness = "owner_current"): LodePackageAdmissionContract {
  return {
    package_ref: packageRef,
    source_ref: packageRef,
    lock_ref: lockRef,
    capability_id: "search-notes",
    operation_id: "xhs_search_notes",
    operation_mode: "read",
    version: "0.1.0",
    lifecycle: "active",
    runtime_admission: { enabled: true, status: "current", recheck_condition: "not_applicable" },
    resource_requirements: {
      resource_requirements_id: "xiaohongshu.search-notes.resources",
      package_ref: packageRef,
      operation_mode: "read",
      resource_requirement_profiles: [{
        requirement_profile_id: "identity-preview",
        required_harbor_facts: [{ fact_key: "identity.user_logged_in.confirmed", owner: "Harbor", required: true, freshness }]
      }]
    },
    runtime_consumption: {
      allowlist_id: "lode.runtime-consumption.v0",
      allowlist_version: "0.1.0",
      asset_owner: "Lode",
      consumer: { repository: "WebEnvoy/WebEnvoy", issue: "299", purpose: "identity compatibility preview" },
      package_ref: packageRef,
      lock_ref: lockRef,
      version: "0.1.0",
      site_slug: "xiaohongshu",
      operation_id: "xhs_search_notes",
      operation_mode: "read",
      lifecycle: "active",
      allowed_origins: ["https://www.xiaohongshu.com"],
      resource_requirements_id: "xiaohongshu.search-notes.resources",
      failure_mapping_id: "xhs-search-failures",
      required_failure_classes: ["resource_requirement_unmatched"],
      required_source_ref_kinds: ["source_trace_ref"],
      required_evidence_ref_kinds: ["snapshot_ref"],
      post_check_id: "xhs-search-post-check",
      required_post_check_fields: ["status"]
    }
  };
}

function identityFacts(identityRef: string, overrides: Partial<HarborIdentityEnvironmentFacts> = {}): HarborIdentityEnvironmentFacts {
  return {
    schema_version: "harbor-local-identity-environment/v0",
    identity_environment_ref: identityRef,
    execution_identity_ref: `execution:${identityRef}`,
    profile_ref: `profile:${identityRef}`,
    site_binding: { site_id: "xiaohongshu", origin: "https://www.xiaohongshu.com" },
    login_state: {
      state: "logged_in",
      authentication_provenance: "manual",
      manual_authentication_state: "confirmed",
      recovery_required: false
    },
    browser_storage: { state: "present" },
    provider_binding: { selected_provider_id: "cloakbrowser", binding_status: "public_record_provider_available" },
    consumer_boundary: {
      core: "admission_facts_refs_and_blocking_reasons_only",
      not_exposed: ["password", "verification_code", "cookie_value", "storage_value", "session_token"]
    },
    ...overrides
  };
}

function request(identityRefs: readonly string[], overrides: Partial<IdentityCompatibilityPreviewRequest> = {}): IdentityCompatibilityPreviewRequest {
  return {
    schema_version: identityCompatibilityPreviewRequestSchemaVersion,
    package_ref: packageRef,
    lock_ref: lockRef,
    version: "0.1.0",
    operation_id: "xhs_search_notes",
    operation_mode: "read",
    identity_environment_refs: identityRefs,
    ...overrides
  };
}

function reader(results: Readonly<Record<string, Awaited<ReturnType<HarborIdentityFactsReader>>>>): HarborIdentityFactsReader {
  return async (identityRef) => results[identityRef] ?? { ok: false, owner_status: "unavailable", reason_code: "identity_environment_not_found" };
}

function availableRead(facts: HarborIdentityEnvironmentFacts, observedAt: string) {
  return { ok: true as const, owner_readiness: "ready" as const, provider_status: providerStatus, facts, observed_at: observedAt };
}

export async function assertIdentityCompatibilityPreview(): Promise<void> {
  const refs = ["identity-compatible", "identity-site-mismatch", "identity-origin-mismatch", "identity-setup", "identity-runtime", "identity-stale", "identity-malformed", "identity-unavailable"];
  const factsReader = reader({
    "identity-compatible": availableRead(identityFacts("identity-compatible"), "2026-07-21T07:59:30.000Z"),
    "identity-site-mismatch": availableRead(
      identityFacts("identity-site-mismatch", { site_binding: { site_id: "boss", origin: "https://www.zhipin.com" } }),
      "2026-07-21T07:59:30.000Z"
    ),
    "identity-origin-mismatch": availableRead(
      identityFacts("identity-origin-mismatch", { site_binding: { site_id: "xiaohongshu", origin: "https://example.org" } }),
      "2026-07-21T07:59:30.000Z"
    ),
    "identity-setup": availableRead(
      identityFacts("identity-setup", { login_state: { state: "logged_out", recovery_required: true } }),
      "2026-07-21T07:59:30.000Z"
    ),
    "identity-runtime": availableRead(identityFacts("identity-runtime"), "2026-07-21T07:59:30.000Z"),
    "identity-stale": availableRead(identityFacts("identity-stale"), "2026-07-21T07:00:00.000Z"),
    "identity-malformed": { ok: false, owner_status: "malformed", reason_code: "harbor_identity_facts_malformed" },
    "identity-unavailable": { ok: false, owner_status: "unavailable", reason_code: "harbor_owner_unavailable" }
  });
  const baseDependencies = {
    lodePackageResolver: async () => packageContract(),
    harborIdentityFactsReader: factsReader,
    clock: () => now
  };

  const deterministic = await previewIdentityCompatibility(request(refs.slice(0, 4)), baseDependencies);
  assert(!("category" in deterministic));
  assert.equal(deterministic.candidates[0]?.status, "compatible");
  assert.equal(deterministic.candidates[1]?.status, "incompatible");
  assert.deepEqual(deterministic.candidates[1]?.reason_codes, ["identity_site_mismatch"]);
  assert.deepEqual(deterministic.candidates[2]?.reason_codes, ["identity_origin_mismatch"]);
  assert.equal(deterministic.candidates[3]?.status, "requires_setup");
  assert.equal(deterministic.candidates[3]?.recovery_action, "open_manual_auth");

  const runtimeUnknown = await previewIdentityCompatibility(request(["identity-runtime"]), {
    ...baseDependencies,
    lodePackageResolver: async () => packageContract("current_execution_window")
  });
  assert(!("category" in runtimeUnknown));
  assert.equal(runtimeUnknown.candidates[0]?.status, "unknown_until_runtime");
  assert.equal(runtimeUnknown.candidates[0]?.fact_freshness[0]?.state, "unknown_until_runtime");

  const providerSetup = await previewIdentityCompatibility(request(["identity-compatible"]), {
    ...baseDependencies,
    harborIdentityFactsReader: async () => ({
      ...availableRead(identityFacts("identity-compatible"), "2026-07-21T07:59:30.000Z"),
      provider_status: {
        schema_version: "harbor-browser-provider-status/v0",
        providers: [{ provider_id: "cloakbrowser", install: { status: "missing", launchability: "unavailable" } }]
      }
    })
  });
  assert(!("category" in providerSetup));
  assert.equal(providerSetup.candidates[0]?.status, "requires_setup");
  assert.equal(providerSetup.candidates[0]?.recovery_action, "install_or_select_provider");

  const ownerFailures = await previewIdentityCompatibility(request(refs.slice(5)), baseDependencies);
  assert(!("category" in ownerFailures));
  assert.equal(ownerFailures.candidates[0]?.owner_status.harbor, "stale");
  assert.equal(ownerFailures.candidates[1]?.owner_status.harbor, "malformed");
  assert.equal(ownerFailures.candidates[2]?.owner_status.harbor, "unavailable");
  assert(ownerFailures.candidates.every((candidate) => candidate.status === "incompatible"));

  let reads = 0;
  const noRead: HarborIdentityFactsReader = async () => {
    reads += 1;
    return { ok: false, owner_status: "unavailable", reason_code: "unexpected" };
  };
  const lockMismatch = await previewIdentityCompatibility(request(["identity-compatible"], { lock_ref: `${lockRef}-wrong` }), {
    ...baseDependencies,
    harborIdentityFactsReader: noRead
  });
  assert(!("category" in lockMismatch));
  assert.deepEqual(lockMismatch.candidates[0]?.reason_codes, ["package_lock_mismatch"]);
  const versionMismatch = await previewIdentityCompatibility(request(["identity-compatible"], { version: "9.9.9" }), {
    ...baseDependencies,
    harborIdentityFactsReader: noRead
  });
  assert(!("category" in versionMismatch));
  assert.deepEqual(versionMismatch.candidates[0]?.reason_codes, ["package_version_mismatch"]);
  assert.equal(reads, 0, "lock/version mismatch must not read Harbor");

  const rejected = await previewIdentityCompatibility({ ...request(["identity-compatible"]), token: "private" }, baseDependencies);
  assert("category" in rejected);
  assert.equal(rejected.code, "private_field_rejected:token");

  const observedRequests: { input: string; init?: RequestInit }[] = [];
  const publicRecord = {
    schema_version: "harbor-local-identity-environment-store/v0",
    identity_environment_ref: "identity-http",
    updated_at: "2026-07-21T07:59:30.000Z",
    site: { site_id: "xiaohongshu", origin: "https://www.xiaohongshu.com" },
    status: {
      login_state: "logged_in",
      recovery_required: false,
      authentication_provenance: "manual",
      manual_authentication_state: "confirmed",
      browser_storage_state: "present"
    },
    refs: { execution_identity_ref: "execution:identity-http", profile_ref: "profile:identity-http" },
    environment_summary: { provider_id: "cloakbrowser" }
  };
  const httpReader = createHttpHarborIdentityFactsReader({
    baseUrl: "http://127.0.0.1:18787",
    fetch: async (input, init) => {
      const url = String(input);
      observedRequests.push({ input: url, ...(init === undefined ? {} : { init }) });
      const body = url.endsWith("/readiness") ? { status: "ready" }
        : url.endsWith("/runtime/browser-providers") ? providerStatus
        : publicRecord;
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    }
  });
  const httpResult = await httpReader("identity-http");
  assert.equal(httpResult.ok, true);
  assert.deepEqual(observedRequests.map((request) => request.input).sort(), [
    "http://127.0.0.1:18787/readiness",
    "http://127.0.0.1:18787/runtime/browser-providers",
    "http://127.0.0.1:18787/runtime/identity-environments/identity-http"
  ]);
  assert(observedRequests.every((request) => request.init?.method === "GET" && request.init.body === undefined));

  const privateReader = createHttpHarborIdentityFactsReader({
    baseUrl: "http://127.0.0.1:18787",
    fetch: async (input) => {
      const url = String(input);
      const body = url.endsWith("/readiness") ? { status: "ready" }
        : url.endsWith("/runtime/browser-providers") ? providerStatus
        : { ...publicRecord, token: "must-not-be-consumed" };
      return new Response(JSON.stringify(body), { status: 200 });
    }
  });
  const privateResult = await privateReader("identity-http");
  assert.equal(privateResult.ok, false);
  if (!privateResult.ok) assert.equal(privateResult.owner_status, "malformed");
}
