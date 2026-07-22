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
import { matchLockedLodeOperation, matchLockedOperationIdentity } from "./operation-identity-matcher.js";

const packageRef = "lode://site-capability/xiaohongshu/search-notes@0.1.0";
const lockRef = "lode://lock/site-capability/xiaohongshu/search-notes@0.1.0";
const detailPackageRef = "lode://site-capability/xiaohongshu/read-note-detail@0.1.0";
const detailLockRef = "lode://lock/site-capability/xiaohongshu/read-note-detail@0.1.0";
const detailRef = "detail_ref_12345678-1234-4123-8123-123456789abc";
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

function multiProfilePackageContract(): LodePackageAdmissionContract {
  const contract = packageContract();
  return {
    ...contract,
    resource_requirements: {
      ...contract.resource_requirements,
      resource_requirement_profiles: [
        ...contract.resource_requirements.resource_requirement_profiles,
        {
          requirement_profile_id: "runtime-fallback",
          operation_boundary: "read",
          required_harbor_facts: [{ fact_key: "identity.fallback_only.confirmed", owner: "Harbor", required: true }]
        }
      ]
    }
  };
}

function detailPackageContract(): LodePackageAdmissionContract {
  return {
    ...packageContract(),
    package_ref: detailPackageRef,
    source_ref: detailPackageRef,
    lock_ref: detailLockRef,
    capability_id: "read-note-detail",
    operation_id: "xhs_read_note_detail",
    resource_requirements: {
      resource_requirements_id: "xiaohongshu.read-note-detail.resources",
      package_ref: detailPackageRef,
      operation_mode: "read",
      resource_requirement_profiles: [{
        requirement_profile_id: "identity-detail-preview",
        operation_boundary: "read",
        required_harbor_facts: [{ fact_key: "identity.user_logged_in.confirmed", owner: "Harbor", required: true, freshness: "owner_current" }]
      }]
    },
    runtime_consumption: {
      ...packageContract().runtime_consumption!,
      package_ref: detailPackageRef,
      lock_ref: detailLockRef,
      operation_id: "xhs_read_note_detail",
      resource_requirements_id: "xiaohongshu.read-note-detail.resources"
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
      authentication_provenance: "user_confirmed_managed_session",
      manual_authentication_state: "completed",
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
    target_ref: "https://www.xiaohongshu.com/search_result/?keyword=city%20coffee",
    target_origin: "https://www.xiaohongshu.com",
    resource_requirement_ref: "xiaohongshu.search-notes.resources",
    resource_requirement_profile_id: "identity-preview",
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
  assert.equal(deterministic.target_ref, "https://www.xiaohongshu.com/search_result/?keyword=city%20coffee");

  const canonicalTarget = await previewIdentityCompatibility(request(["identity-compatible"], {
    target_ref: "HTTPS://WWW.XIAOHONGSHU.COM:443/search_result/../search_result/?keyword=city%20coffee"
  }), baseDependencies);
  assert(!("category" in canonicalTarget));
  assert.equal(canonicalTarget.target_ref, "https://www.xiaohongshu.com/search_result/?keyword=city%20coffee");

  for (const sensitiveTarget of [
    "https://preview-user:preview-password@www.xiaohongshu.com/search_result/",
    "https://www.xiaohongshu.com/search_result/?access_token=must-not-echo",
    "https://www.xiaohongshu.com/search_result/?next=secret"
  ]) {
    const rejectedTarget = await previewIdentityCompatibility(request(["identity-compatible"], { target_ref: sensitiveTarget }), baseDependencies);
    assert("category" in rejectedTarget);
    assert.equal(rejectedTarget.code, "identity_compatibility_request_invalid");
    assert.equal(JSON.stringify(rejectedTarget).includes("must-not-echo"), false);
    assert.equal(JSON.stringify(rejectedTarget).includes("preview-password"), false);
  }

  const invalidOpaque = await previewIdentityCompatibility(request(["identity-compatible"], { target_ref: "arbitrary-opaque-target" }), baseDependencies);
  assert("category" in invalidOpaque);
  assert.equal(invalidOpaque.code, "identity_compatibility_request_invalid");

  const detailPreview = await previewIdentityCompatibility(request(["identity-compatible"], {
    package_ref: detailPackageRef,
    lock_ref: detailLockRef,
    operation_id: "xhs_read_note_detail",
    target_ref: detailRef,
    resource_requirement_ref: "xiaohongshu.read-note-detail.resources",
    resource_requirement_profile_id: "identity-detail-preview"
  }), {
    ...baseDependencies,
    lodePackageResolver: async () => detailPackageContract()
  });
  assert(!("category" in detailPreview));
  assert.equal(detailPreview.candidates[0]?.status, "compatible");
  assert.equal(detailPreview.target_ref, detailRef);

  const detailUrlPreview = await previewIdentityCompatibility(request(["identity-compatible"], {
    package_ref: detailPackageRef,
    lock_ref: detailLockRef,
    operation_id: "xhs_read_note_detail",
    target_ref: "https://www.xiaohongshu.com/explore/note-123",
    resource_requirement_ref: "xiaohongshu.read-note-detail.resources",
    resource_requirement_profile_id: "identity-detail-preview"
  }), {
    ...baseDependencies,
    lodePackageResolver: async () => detailPackageContract()
  });
  assert("category" in detailUrlPreview);
  assert.equal(detailUrlPreview.code, "identity_compatibility_request_invalid");

  const unsupportedOpaque = await previewIdentityCompatibility(request(["identity-compatible"], { target_ref: detailRef }), baseDependencies);
  assert("category" in unsupportedOpaque);
  assert.equal(unsupportedOpaque.code, "identity_compatibility_request_invalid");

  const multiProfilePreview = await previewIdentityCompatibility(request(["identity-compatible"]), {
    ...baseDependencies,
    lodePackageResolver: async () => multiProfilePackageContract()
  });
  assert(!("category" in multiProfilePreview));
  assert.equal(multiProfilePreview.candidates[0]?.status, "compatible");
  const fallbackProfilePreview = await previewIdentityCompatibility(request(["identity-compatible"], {
    resource_requirement_profile_id: "runtime-fallback"
  }), {
    ...baseDependencies,
    lodePackageResolver: async () => multiProfilePackageContract()
  });
  assert(!("category" in fallbackProfilePreview));
  assert.equal(fallbackProfilePreview.candidates[0]?.status, "unknown_until_runtime");
  const formalMultiProfileMatch = matchLockedLodeOperation(multiProfilePackageContract(), {
    package_ref: packageRef,
    lock_ref: lockRef,
    version: "0.1.0",
    operation_id: "xhs_search_notes",
    operation_mode: "read",
    target_ref: "https://www.xiaohongshu.com/search_result/?keyword=city%20coffee",
    target_origin: "https://www.xiaohongshu.com",
    resource_requirement_ref: "xiaohongshu.search-notes.resources",
    resource_requirement_profile_id: "identity-preview"
  });
  assert(!("category" in formalMultiProfileMatch));
  assert.equal(matchLockedOperationIdentity(formalMultiProfileMatch, identityFacts("identity-compatible"), "identity-compatible"), undefined);

  const uncertainAuthentication = identityFacts("identity-auth-uncertain", {
    login_state: {
      state: "logged_in",
      authentication_provenance: "unknown",
      manual_authentication_state: "pending",
      recovery_required: false
    }
  });
  const operation = matchLockedLodeOperation(packageContract(), request(["identity-auth-uncertain"]));
  assert(!("category" in operation));
  assert.equal(matchLockedOperationIdentity(operation, uncertainAuthentication, "identity-auth-uncertain")?.code, "identity_auth_required");
  const uncertainPreview = await previewIdentityCompatibility(request(["identity-auth-uncertain"]), {
    ...baseDependencies,
    harborIdentityFactsReader: reader({
      "identity-auth-uncertain": availableRead(uncertainAuthentication, "2026-07-21T07:59:30.000Z")
    })
  });
  assert(!("category" in uncertainPreview));
  assert.equal(uncertainPreview.candidates[0]?.status, "requires_setup");
  assert.deepEqual(uncertainPreview.candidates[0]?.reason_codes, ["identity_auth_required"]);

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
  const targetMismatch = await previewIdentityCompatibility(request(["identity-compatible"], { target_origin: "https://example.org" }), {
    ...baseDependencies,
    harborIdentityFactsReader: noRead
  });
  assert("category" in targetMismatch);
  assert.equal(targetMismatch.code, "identity_compatibility_request_invalid");
  const selectionMismatches = [
    { resource_requirement_ref: "xiaohongshu.other.resources" },
    { resource_requirement_profile_id: "other-profile" }
  ];
  for (const mismatch of selectionMismatches) {
    const result = await previewIdentityCompatibility(request(["identity-compatible"], mismatch), {
      ...baseDependencies,
      harborIdentityFactsReader: noRead
    });
    assert(!("category" in result));
    assert.equal(result.candidates[0]?.owner_status.harbor, "not_checked");
  }
  assert.equal(reads, 0, "lock, version, target, and resource mismatch must not read Harbor");

  const rejected = await previewIdentityCompatibility({ ...request(["identity-compatible"]), token: "private" }, baseDependencies);
  assert("category" in rejected);
  assert.equal(rejected.code, "private_field_rejected:token");

  const observedRequests: { input: string; init?: RequestInit }[] = [];
  const publicRecord = {
    schema_version: "harbor-local-identity-environment-store/v0",
    identity_environment_ref: "identity-http",
    updated_at: "2026-01-01T00:00:00.000Z",
    site: { site_id: "xiaohongshu", origin: "https://www.xiaohongshu.com" },
    status: {
      login_state: "logged_in",
      recovery_required: false,
      authentication_provenance: "user_confirmed_managed_session",
      manual_authentication_state: "completed",
      browser_storage_state: "present"
    },
    refs: { execution_identity_ref: "execution:identity-http", profile_ref: "profile:identity-http" },
    environment_summary: { provider_id: "cloakbrowser" }
  };
  const httpReader = createHttpHarborIdentityFactsReader({
    baseUrl: "http://127.0.0.1:18787",
    clock: () => now,
    fetch: async (input, init) => {
      const url = String(input);
      observedRequests.push({ input: url, ...(init === undefined ? {} : { init }) });
      const body = url.endsWith("/readiness") ? { status: "ready" }
        : url.endsWith("/runtime/browser-providers") ? providerStatus
        : publicRecord;
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json; charset=utf-8" } });
    }
  });
  const httpResult = await httpReader("identity-http");
  assert.equal(httpResult.ok, true);
  if (httpResult.ok) assert.equal(httpResult.observed_at, now.toISOString());
  assert.deepEqual(observedRequests.map((request) => request.input).sort(), [
    "http://127.0.0.1:18787/readiness",
    "http://127.0.0.1:18787/runtime/browser-providers",
    "http://127.0.0.1:18787/runtime/identity-environments/identity-http"
  ]);
  assert(observedRequests.every((request) => request.init?.method === "GET" && request.init.body === undefined));

  const oldRecordPreview = await previewIdentityCompatibility(request(["identity-http"]), {
    ...baseDependencies,
    harborIdentityFactsReader: httpReader
  });
  assert(!("category" in oldRecordPreview));
  assert.equal(oldRecordPreview.candidates[0]?.status, "compatible");
  assert.equal(oldRecordPreview.candidates[0]?.freshness.observed_at, now.toISOString());

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

  let streamingCancels = 0;
  const oversizedReader = createHttpHarborIdentityFactsReader({
    baseUrl: "http://127.0.0.1:18787",
    fetch: async () => new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(64 * 1024 + 1));
      },
      cancel() {
        streamingCancels += 1;
      }
    }), { status: 200, headers: { "content-type": "application/json" } })
  });
  const oversizedResult = await oversizedReader("identity-http");
  assert.equal(oversizedResult.ok, false);
  assert(streamingCancels > 0, "oversized Harbor responses must cancel their streams");

  let declaredLengthCancels = 0;
  const declaredOversizedReader = createHttpHarborIdentityFactsReader({
    baseUrl: "http://127.0.0.1:18787",
    fetch: async () => new Response(new ReadableStream<Uint8Array>({
      cancel() {
        declaredLengthCancels += 1;
      }
    }), { status: 200, headers: { "content-type": "application/json", "content-length": String(64 * 1024 + 1) } })
  });
  const declaredOversizedResult = await declaredOversizedReader("identity-http");
  assert.equal(declaredOversizedResult.ok, false);
  assert(declaredLengthCancels > 0, "oversized Content-Length must cancel before reading");

  let oversizedOverrideCancels = 0;
  const oversizedOverrideReader = createHttpHarborIdentityFactsReader({
    baseUrl: "http://127.0.0.1:18787",
    maxResponseBytes: 70 * 1024,
    fetch: async () => new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(64 * 1024 + 1));
      },
      cancel() {
        oversizedOverrideCancels += 1;
      }
    }), { status: 200, headers: { "content-type": "application/json" } })
  });
  const oversizedOverrideResult = await oversizedOverrideReader("identity-http");
  assert.equal(oversizedOverrideResult.ok, false);
  assert(oversizedOverrideCancels > 0, "caller overrides must not raise the 64 KiB hard cap");

  let errorBodyCancels = 0;
  const errorBodyReader = createHttpHarborIdentityFactsReader({
    baseUrl: "http://127.0.0.1:18787",
    fetch: async () => new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(64 * 1024 + 1));
      },
      cancel() {
        errorBodyCancels += 1;
      }
    }), { status: 503, headers: { "content-type": "application/json" } })
  });
  const errorBodyResult = await errorBodyReader("identity-http");
  assert.equal(errorBodyResult.ok, false);
  assert(errorBodyCancels > 0, "non-2xx Harbor response streams must be cancelled before returning");
}
