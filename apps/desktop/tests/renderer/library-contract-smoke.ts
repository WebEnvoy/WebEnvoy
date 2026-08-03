import { ownerApiResponseMaxBytes, readBoundedJsonResponse } from "../../src/electron/boundedJsonResponse";
import { checkRejectedAuthorizationDecisions } from "./authorization-decision-contract-smoke";
import {
  compatibilityTargetFieldId,
  createSkillIdentityCompatibilityRequest,
  parseSkillIdentityCompatibilityResponse,
  projectCompatibilityTarget,
} from "../../src/renderer/coreIdentityCompatibilityClient";
import { buildCoreThreadInputSnapshot, prepareTaskTurnRequest, projectTaskSubmissionSkill } from "../../src/renderer/coreTaskThreadSubmitClient";
import { coreTaskSubmitFailureSummary, coreTaskSubmitReadiness, readOnlyIdentityAdmissionBlockReason } from "../../src/renderer/coreTaskSubmitClient";
import { projectCoreThreadResponse } from "../../src/renderer/coreThreadClient";
import { parseCoreThreadInputSnapshot } from "../../src/renderer/coreThreadInputContract";
import { projectLodeCatalogDisplayCache, type LodeCatalogLoadState, type LodeCatalogSkill } from "../../src/renderer/lodeCatalogClient";
import { createLatestRequestGate } from "../../src/renderer/latestRequestGate";
import { executionPolicyModeMutation } from "../../src/renderer/executionPolicyClient";
import { browserAttachments, refreshLocalAttachments, selectLocalAttachments } from "../../src/renderer/localFileClient";
import { projectOwnerHttpStatusError } from "../../src/renderer/ownerApiClient";
import { createSkillInputDraft, validateSkillInputDraft } from "../../src/renderer/skillInputDraft";
import { clearSkillInputDraft, loadSkillInputDraft, saveSkillInputDraft } from "../../src/renderer/skillInputDraftStore";
import { compatibilityRecoveryCopy } from "../../src/renderer/skillCompatibilityPresentation";
import { terminalSkillInputOwnerRefs } from "../../src/renderer/skillInputOwnerClient";
import { findCatalogSkillForTask } from "../../src/renderer/useAppController";
import { identityFactsFromPublicRecord } from "../../src/renderer/harborIdentityClient";
import { projectHarborIdentity } from "../../src/renderer/harborIdentityProjection";
import { identity, identityB, runtime } from "./library-harness-fixtures";
import { taskThreadFixtures } from "../../src/renderer/taskThreadFixtures";

type SmokeInput = {
  catalog: LodeCatalogLoadState;
  detailSkill: LodeCatalogSkill;
  identityEnvironmentRef: string;
  protectedDrafts: Map<string, unknown>;
  xhsSkill: LodeCatalogSkill;
};

const consumerBoundary =
  "Core returns bounded compatibility reasons and public freshness only; no task, thread, run, session, browser action, credential, cookie, token, profile storage, evidence body, or raw owner response is created or exposed.";

export async function runLibraryContractSmoke(input: SmokeInput) {
  const request = checkRequestProjection(input);
  checkResponseProjection(request);
  checkTurnInputProjection(input.xhsSkill);
  checkXhsSearchTarget(input.xhsSkill);
  checkResultDetailTurn(input.detailSkill);
  checkExecutionPolicyMutation();
  await checkDraftProjection(input);
  await checkOwnerBoundaries(input.catalog);
  await checkRejectedAuthorizationDecisions();
}

function checkXhsSearchTarget(skill: LodeCatalogSkill) {
  const prepareSearch = (limit: string) => {
    const draft = createSkillInputDraft(skill);
    draft.values.url = "https://example.test/stale-hidden-search-target";
    draft.values.keyword = "AI tools";
    draft.values.limit = limit;
    return prepareTaskTurnRequest({
      endpoint: "http://core.owner",
      skill,
      identity,
      draft,
      ownerRefs: {
        ownerRef: "draft:app-protected/00000000-0000-4000-8000-000000000022",
        fieldOwnerRefs: {
          url: "draft:app-protected/00000000-0000-4000-8000-000000000022/url",
          keyword: "draft:app-protected/00000000-0000-4000-8000-000000000022/keyword",
        },
        attachmentRefs: {},
      },
      executionPolicy: automaticExecutionPolicy(skill),
      runtime,
    });
  };
  for (const pathname of ["/search_result", "/search_result/"]) {
    const draft = createSkillInputDraft(skill);
    draft.values.url = `https://www.xiaohongshu.com${pathname}?keyword=old&source=web_search_result_notes&xsec_token=must-not-pass`;
    draft.values.keyword = "AI tools";
    draft.values.limit = "8";
    const prepared = prepareTaskTurnRequest({
      endpoint: "http://core.owner",
      skill,
      identity,
      draft,
      ownerRefs: {
        ownerRef: "draft:app-protected/00000000-0000-4000-8000-000000000022",
        fieldOwnerRefs: {
          url: "draft:app-protected/00000000-0000-4000-8000-000000000022/url",
          keyword: "draft:app-protected/00000000-0000-4000-8000-000000000022/keyword",
        },
        attachmentRefs: {},
      },
      executionPolicy: automaticExecutionPolicy(skill),
      runtime,
    });
    if (!prepared.ok) throw new Error(`Core search turn target was rejected: ${prepared.reason}`);
    const target = (prepared.request.task_intent as { scope?: { target_ref?: string } }).scope?.target_ref;
    const harborUrl = (prepared.request.harbor as { url?: string } | undefined)?.url;
    const publicQuery = prepared.request.public_query as { query?: string; limit?: number } | undefined;
    const expected = "https://www.xiaohongshu.com/search_result?keyword=AI+tools&source=web_search_result_notes";
    if (target !== expected || harborUrl !== expected || publicQuery?.query !== "AI tools" || publicQuery.limit !== 8 || `${target}${harborUrl}`.includes("xsec_token")) {
      throw new Error("Xiaohongshu search target did not preserve only the allowlisted source parameter.");
    }
  }
  for (const limit of ["1", "15"]) {
    const prepared = prepareSearch(limit);
    if (!prepared.ok || (prepared.request.public_query as { limit?: number }).limit !== Number(limit)) {
      throw new Error(`Valid Xiaohongshu search limit ${limit} was rejected.`);
    }
  }
  for (const limit of ["0", "1.5", "16"]) {
    if (prepareSearch(limit).ok) throw new Error(`Invalid Xiaohongshu search limit ${limit} was accepted.`);
  }
  const submissionSkill = projectTaskSubmissionSkill(skill);
  const draft = createSkillInputDraft(submissionSkill);
  draft.values.limit = "16";
  if (validateSkillInputDraft(submissionSkill, draft).limit == null ||
    submissionSkill.inputFields.some((field) => field.id === "url") ||
    submissionSkill.inputFields.find((field) => field.id === "limit")?.maximum !== 15) {
    throw new Error("Composer did not project keyword-only Xiaohongshu search inputs and the runtime limit.");
  }
  const defaulted = prepareSearch("");
  if (!defaulted.ok || (defaulted.request.public_query as { limit?: number }).limit !== 10) {
    throw new Error("An omitted Xiaohongshu search limit did not use the declared skill default.");
  }
}

function checkResultDetailTurn(detailSkill: LodeCatalogSkill) {
  const detailRef = "detail_ref_123e4567-e89b-42d3-a456-426614174000";
  const skill = detailSkill;
  const executionPolicy = automaticExecutionPolicy(skill);
  const prepared = prepareTaskTurnRequest({
    endpoint: "http://core.owner",
    skill,
    identity,
    draft: { values: {}, files: {} },
    ownerRefs: { ownerRef: "draft:app-protected/00000000-0000-4000-8000-000000000021", fieldOwnerRefs: {}, attachmentRefs: {} },
    executionPolicy,
    runtime,
    ownerTargetRef: detailRef,
  });
  if (!prepared.ok) throw new Error(`Core detail turn handoff was rejected: ${prepared.reason}`);
  const intent = prepared.request.task_intent as {
    input?: { refs?: string[] };
    scope?: { target_type?: string; target_ref?: string };
  };
  const harbor = prepared.request.harbor as { url?: string } | undefined;
  if (
    JSON.stringify(intent.input?.refs) !== JSON.stringify([detailRef]) ||
    intent.scope?.target_type !== "xiaohongshu_note_detail" ||
    intent.scope.target_ref !== detailRef ||
    prepared.request.public_query !== undefined ||
    harbor?.url !== undefined
  ) {
    throw new Error("Search-to-detail handoff did not use the Core-owned opaque detail-ref contract.");
  }
  const mismatched = prepareTaskTurnRequest({
    endpoint: "http://core.owner",
    skill: { ...skill, lockRef: "lode://lock/site-capability/xiaohongshu/read-note-detail@0.1.1" },
    identity,
    draft: { values: {}, files: {} },
    ownerRefs: { ownerRef: "draft:app-protected/00000000-0000-4000-8000-000000000021", fieldOwnerRefs: {}, attachmentRefs: {} },
    executionPolicy,
    runtime,
    ownerTargetRef: detailRef,
  });
  if (mismatched.ok) throw new Error("A detail ref was accepted with a mismatched package lock.");
}

function automaticExecutionPolicy(skill: LodeCatalogSkill) {
  return {
    skillRef: skill.packageRef,
    actions: [{
      actionId: skill.actions[0]!.id,
      category: "read" as const,
      riskMarker: null,
      targetScope: { siteSlug: skill.siteSlug, targetTypes: skill.actions[0]!.targetTypes, supportedOrigins: skill.actions[0]!.supportedOrigins },
      policy: { mode: "auto" as const, source: "installed_skill_user_version" as const, sourceRef: `execution-policy:skill/${skill.id}`, sourceVersion: "1" },
    }],
  };
}

function checkExecutionPolicyMutation() {
  const mutation = executionPolicyModeMutation(
    { read: "auto", prepare: "confirm", commit: "deny", destructive: "auto" },
    new Set(["prepare"] as const),
  );
  if (JSON.stringify(mutation) !== JSON.stringify({ prepare: "confirm" })) {
    throw new Error("Thread execution policy mutation persisted inherited categories that the user did not modify.");
  }
}

function checkTurnInputProjection(xhsSkill: LodeCatalogSkill) {
  const thread = {
    schema_version: "webenvoy.task-thread.v0",
    thread_id: "thread_22222222222222222222222222222222",
    capability_ref: "lode:capability/search-notes",
    identity_environment_ref: "identity-env_aaaaaaaaaaaaaaaaaaaaaaaa",
    created_at: "2026-07-20T00:00:00.000Z",
    updated_at: "2026-07-20T00:00:00.000Z",
    turns: [],
  };
  const historicalTask = projectCoreThreadResponse({ ok: true, thread });
  if (historicalTask == null ||
    projectCoreThreadResponse({ ok: true, thread: { ...thread, identity_environment_ref: "identity-env-live-xhs-chrome-20260710" } }) == null ||
    projectCoreThreadResponse({ ok: true, thread: { ...thread, identity_environment_ref: "identity-env:legacy-safe" } }) == null ||
    projectCoreThreadResponse({ ok: true, thread: { ...thread, identity_environment_ref: "identity-env-token-secret" } }) != null ||
    projectCoreThreadResponse({ ok: true, thread: { ...thread, identity_environment_ref: "harbor://identity-environment/unsafe" } }) != null) {
    throw new Error("Core thread projection did not distinguish canonical, safe legacy, and unsupported identity refs.");
  }
  const exactTask = {
    ...historicalTask,
    packageSource: { ...historicalTask.packageSource, sourceRef: xhsSkill.packageRef, version: xhsSkill.version },
  };
  if (findCatalogSkillForTask(historicalTask, [xhsSkill]) != null || findCatalogSkillForTask(exactTask, [xhsSkill]) !== xhsSkill) {
    throw new Error("Historical thread mounted a current Catalog skill without an exact package and version binding.");
  }
  const ownerRef = "draft:app-protected/00000000-0000-4000-8000-000000000020";
  const terminalTask = projectCoreThreadResponse({ ok: true, thread: { ...thread, turns: [{
    turn_id: "turn_22222222222222222222222222222222",
    sequence: 1,
    idempotency_key: "app-turn-22222222-2222-4222-8222-222222222222",
    run_id: "app-xhs-22222222-2222-4222-8222-222222222222",
    creation_channel: "app",
    input: {
      schema_version: "webenvoy.task-turn-input.v0",
      fields: [{ field_id: "keyword", kind: "long_text", owner_ref: `${ownerRef}/keyword` }],
      attachment_refs: [`attachment:app-protected/${ownerRef.slice("draft:app-protected/".length)}/attachments/0`],
      consumer_boundary: "Core stores bounded field summaries and owner refs only; raw content remains with its owner.",
    },
    created_at: "2026-07-20T00:00:00.000Z",
    updated_at: "2026-07-20T00:01:00.000Z",
    submission_state: "accepted",
    status: "completed",
    terminal_at: "2026-07-20T00:01:00.000Z",
  }] } });
  if (terminalTask == null || JSON.stringify(terminalSkillInputOwnerRefs([terminalTask])) !== JSON.stringify([ownerRef]) ||
    terminalSkillInputOwnerRefs([{ ...terminalTask, runs: terminalTask.runs.map((run) => ({ ...run, turnStatus: "running" })) }]).length !== 0) {
    throw new Error("Terminal task inputs were not selected for owner cleanup or active inputs were released early.");
  }
  const skill: LodeCatalogSkill = {
    ...xhsSkill,
    inputFields: [
      ...xhsSkill.inputFields,
      { id: "body", label: "Body", kind: "multiline", required: true, description: "Declared long text", inputProjection: "owner_ref" },
      { id: "attachments", label: "Attachments", kind: "file", required: false, description: "Declared files", inputProjection: "owner_ref" },
    ],
  };
  const draft = createSkillInputDraft(skill);
  draft.values.url = "https://www.xiaohongshu.com/explore?query=url-private-sentinel#fragment-private-sentinel";
  draft.values.keyword = "AI tools";
  draft.values.limit = "8";
  draft.values.body = "long-text-private-sentinel";
  draft.files.attachments = browserAttachments([new File(["file-private-sentinel"], "private-name.txt", { type: "text/plain" })]);
  const result = buildCoreThreadInputSnapshot(skill, draft, {
    ownerRef,
    fieldOwnerRefs: Object.fromEntries(skill.inputFields.map((field) => [field.id, `${ownerRef}/${field.id}`])),
    attachmentRefs: { attachments: ["attachment:app-protected/00000000-0000-4000-8000-000000000020/attachments/0"] },
  });
  if (!result.ok) throw new Error(`Valid Core input snapshot was rejected: ${result.reason}`);
  const parsed = parseCoreThreadInputSnapshot(result.value);
  const serialized = JSON.stringify(result.value);
  const fields = Object.fromEntries((parsed?.fields ?? []).map((field) => [field.field_id, field]));
  if (fields.url?.kind !== "long_text" || fields.url.owner_ref !== `${ownerRef}/url` ||
    fields.keyword?.kind !== "long_text" || fields.keyword.owner_ref !== `${ownerRef}/keyword` ||
    fields.limit?.kind !== "scalar" || fields.limit.summary !== "8" ||
    fields.body?.kind !== "long_text" || fields.body.owner_ref !== `${ownerRef}/body` ||
    fields.attachments?.kind !== "file" || result.value.attachment_refs.length !== 1 ||
    /url-private-sentinel|fragment-private-sentinel|long-text-private-sentinel|private-name|file-private-sentinel/.test(serialized)) {
    throw new Error("Core input snapshot mixed scalar, URL, long-text, or file ownership boundaries.");
  }
}

function checkRequestProjection({ detailSkill, identityEnvironmentRef, xhsSkill }: SmokeInput) {
  const request = createSkillIdentityCompatibilityRequest(xhsSkill, [identityEnvironmentRef]);
  if (request == null) throw new Error("Compatibility request was not projected from owner metadata.");
  const ambiguousAction = createSkillIdentityCompatibilityRequest({ ...xhsSkill, actions: [...xhsSkill.actions, xhsSkill.actions[0]!] }, [identityEnvironmentRef]);
  const ambiguousProfile = createSkillIdentityCompatibilityRequest({
    ...xhsSkill,
    actions: [{ ...xhsSkill.actions[0]!, resourceRequirementProfileIds: ["profile-a", "profile-b"] }],
  }, [identityEnvironmentRef]);
  const detailUrl = "https://www.xiaohongshu.com/explore/66aa00000000000001000111?xsec_token=public";
  const detailRef = "detail_ref_123e4567-e89b-12d3-a456-426614174000";
  const detailRequest = createSkillIdentityCompatibilityRequest(detailSkill, [identityEnvironmentRef], detailRef);
  const extraTargetField = { ...detailSkill, inputFields: [...detailSkill.inputFields, { ...detailSkill.inputFields[0]!, id: "alternate_url" }] };
  if (ambiguousAction != null || ambiguousProfile != null ||
    createSkillIdentityCompatibilityRequest(detailSkill, [identityEnvironmentRef]) != null ||
    createSkillIdentityCompatibilityRequest(detailSkill, [identityEnvironmentRef], detailUrl) != null ||
    detailRequest?.target_ref !== detailRef || projectCompatibilityTarget(detailSkill, detailUrl).status !== "direct_url_unavailable" ||
    projectCompatibilityTarget(detailSkill, "https://www.xiaohongshu.com/profile/id").status !== "invalid" ||
    projectCompatibilityTarget(detailSkill, "https://example.test/explore/id").status !== "invalid" ||
    compatibilityTargetFieldId(detailSkill) !== "url" || compatibilityTargetFieldId(extraTargetField) !== undefined) {
    throw new Error("Exact-target compatibility accepted an ambiguous action, URL target_ref, or invalid target context.");
  }
  return request;
}

function checkResponseProjection(request: NonNullable<ReturnType<typeof createSkillIdentityCompatibilityRequest>>) {
  const response = compatibilityResponse(request);
  const now = Date.parse("2026-07-20T00:00:30.000Z");
  const parsed = parseSkillIdentityCompatibilityResponse(response, request, now);
  const repair = parseSkillIdentityCompatibilityResponse({
    ...response,
    candidates: [{
      ...response.candidates[0],
      status: "requires_setup",
      reason_codes: ["provider_conflict"],
      missing_requirement_categories: ["browser_environment"],
      fact_freshness: [],
      recovery_action: "repair_browser_environment",
    }],
  }, request, now);
  const rejects = (candidate: Record<string, unknown>) => parseSkillIdentityCompatibilityResponse({
    ...response,
    candidates: [{ ...response.candidates[0], ...candidate }],
  }, request, now) === null;
  const invalidSemantics = [
    rejects({ status: "compatible", missing_requirement_categories: ["runtime_facts"], recovery_action: "none" }),
    rejects({ status: "compatible", missing_requirement_categories: [], fact_freshness: [], recovery_action: "retry_at_task_submission" }),
    rejects({ status: "unknown_until_runtime", fact_freshness: [] }),
    rejects({ status: "unknown_until_runtime", recovery_action: "none" }),
    rejects({ freshness: { state: "fresh", observed_at: "2026-07-20T00:00:00.000Z", age_ms: 60_000 } }),
  ].every(Boolean);
  const malformed = parseSkillIdentityCompatibilityResponse({
    ...response,
    candidates: [{ ...response.candidates[0], credential: "forbidden" }],
  }, request, now);
  const stale = parseSkillIdentityCompatibilityResponse({
    ...response,
    candidates: [{ ...response.candidates[0], owner_status: { lode: "available", harbor: "stale" }, freshness: { state: "stale", observed_at: "2026-07-20T00:00:00.000Z", age_ms: 30_000 } }],
  }, request, now);
  const expired = parseSkillIdentityCompatibilityResponse({ ...response, generated_at: "2026-07-19T00:00:00.000Z" }, request, now);
  if (parsed?.[0]?.status !== "unknown_until_runtime" || repair?.[0]?.recoveryAction !== "repair_browser_environment" ||
    malformed !== null || stale !== null || expired !== null || !invalidSemantics) {
    throw new Error("Compatibility response validation accepted stale, malformed, or contradictory owner data.");
  }
}

function compatibilityResponse(request: NonNullable<ReturnType<typeof createSkillIdentityCompatibilityRequest>>) {
  return {
    schema_version: "webenvoy.identity-compatibility-preview.v0",
    package_ref: request.package_ref,
    lock_ref: request.lock_ref,
    version: request.version,
    operation_id: request.operation_id,
    operation_mode: request.operation_mode,
    target_ref: request.target_ref,
    target_origin: request.target_origin,
    resource_requirement_ref: request.resource_requirement_ref,
    resource_requirement_profile_id: request.resource_requirement_profile_id,
    generated_at: "2026-07-20T00:00:00.000Z",
    candidates: [{
      identity_environment_ref: request.identity_environment_refs[0],
      status: "unknown_until_runtime",
      reason_codes: ["runtime_facts_require_task_admission"],
      missing_requirement_categories: ["runtime_facts"],
      fact_freshness: [{ fact_key: "runtime.execution_surface.available", required_freshness: "current_execution_window", state: "unknown_until_runtime" }],
      owner_status: { lode: "available", harbor: "available" },
      freshness: { state: "fresh", observed_at: "2026-07-20T00:00:00.000Z", age_ms: 0 },
      recovery_action: "retry_at_task_submission",
    }],
    consumer_boundary: consumerBoundary,
  };
}

async function checkDraftProjection({ protectedDrafts, xhsSkill }: SmokeInput) {
  const skill: LodeCatalogSkill = {
    ...xhsSkill,
    inputFields: [
      { id: "body", label: "Body", kind: "multiline", required: true, description: "Long text", inputProjection: "owner_ref", minLength: 2, maxLength: 10 },
      { id: "attachments", label: "Attachments", kind: "file", required: true, description: "Declared files", inputProjection: "owner_ref" },
      { id: "sections", label: "Sections", kind: "multi-select", required: true, description: "Declared options", inputProjection: "safe_summary", options: ["title", "summary", "links"], defaultValue: ["title"], minItems: 1, maxItems: 2, uniqueItems: true },
      { id: "guard", label: "Guard", kind: "constant", required: true, description: "Declared constant", inputProjection: "safe_summary", defaultValue: "active" },
      { id: "accessToken", label: "Access token", kind: "text", required: false, description: "Credential", inputProjection: "owner_ref" },
      { id: "detailUrl", label: "Detail URL", kind: "text", required: false, description: "Public URL", inputProjection: "owner_ref" },
      { id: "downloadUrl", label: "Download URL", kind: "text", required: false, description: "Public URL", inputProjection: "owner_ref" },
      { id: "awsUrl", label: "AWS URL", kind: "text", required: false, description: "Public URL", inputProjection: "owner_ref" },
      { id: "gcsUrl", label: "GCS URL", kind: "text", required: false, description: "Public URL", inputProjection: "owner_ref" },
      { id: "oauthUrl", label: "OAuth URL", kind: "text", required: false, description: "Public URL", inputProjection: "owner_ref" },
      { id: "fragmentSasUrl", label: "Fragment SAS URL", kind: "text", required: false, description: "Public URL", inputProjection: "owner_ref" },
      { id: "securityId", label: "Security ID", kind: "text", required: false, description: "Credential", inputProjection: "owner_ref" },
    ],
  };
  const draft = createSkillInputDraft(skill);
  const initialErrors = validateSkillInputDraft(skill, draft);
  draft.values.body = "draft";
  draft.files.attachments = browserAttachments([new File(["public"], "public.txt", { type: "text/plain" })]);
  if (Object.keys(validateSkillInputDraft(skill, draft)).length !== 0) throw new Error("Valid structured draft was rejected.");
  draft.files.attachments = Array.from({ length: 33 }, (_, index) => ({
    ...draft.files.attachments[0]!, id: `attachment-${index}`, name: `file-${index}.txt`,
  }));
  const excessiveFiles = validateSkillInputDraft(skill, draft).attachments;
  draft.files.attachments = browserAttachments([new File(["public"], "public.txt", { type: "text/plain" })]);
  draft.values.sections = ["title", "summary", "links"];
  const excessive = validateSkillInputDraft(skill, draft).sections;
  draft.values.sections = ["title", "title"];
  const duplicate = validateSkillInputDraft(skill, draft).sections;
  draft.values.sections = ["title"];
  draft.values.guard = "changed";
  const constant = validateSkillInputDraft(skill, draft).guard;
  draft.values.guard = "active";
  draft.values.accessToken = "secret-token";
  draft.values.detailUrl = "https://www.xiaohongshu.com/explore/id?xsec_token=secret";
  draft.values.downloadUrl = "https://blob.example.test/file?sv=2024-11-04&sp=r&sig=synthetic-secret";
  draft.values.awsUrl = "https://s3.example.test/file?X-Amz-Signature=synthetic-secret";
  draft.values.gcsUrl = "https://storage.example.test/file?X-Goog-Signature=synthetic-secret";
  draft.values.oauthUrl = "https://auth.example.test/callback#access_token=synthetic-secret";
  draft.values.fragmentSasUrl = "https://blob.example.test/file#?sv=2024-11-04&sig=synthetic-secret";
  draft.values.securityId = "secret-id";
  await saveSkillInputDraft(skill, "restart-safe-identity", draft);
  const originalSave = window.webenvoyShell?.saveProtectedDraft;
  if (window.webenvoyShell != null) window.webenvoyShell.saveProtectedDraft = async () => ({ status: "unavailable" });
  const unavailablePersistence = await saveSkillInputDraft(skill, "memory-only-identity", draft);
  const memoryOnlyDraft = await loadSkillInputDraft(skill, "memory-only-identity");
  let raceCall = 0;
  if (window.webenvoyShell != null) window.webenvoyShell.saveProtectedDraft = async () => {
    const call = ++raceCall;
    if (call === 1) await new Promise((resolve) => setTimeout(resolve, 20));
    return { status: call === 1 ? "ready" : "unavailable" };
  };
  const olderDraft = createSkillInputDraft(skill);
  olderDraft.values.body = "older";
  const newerDraft = createSkillInputDraft(skill);
  newerDraft.values.body = "newer";
  await Promise.all([
    saveSkillInputDraft(skill, "save-race-identity", olderDraft),
    saveSkillInputDraft(skill, "save-race-identity", newerDraft),
  ]);
  const racedDraft = await loadSkillInputDraft(skill, "save-race-identity");
  const loadRaceIdentity = "clear-load-race-identity";
  const loadRaceContext = { packageRef: skill.packageRef, version: skill.version, identityId: loadRaceIdentity };
  protectedDrafts.set(`${skill.packageRef}:${skill.version}:${loadRaceIdentity}`, {
    context: loadRaceContext, values: { body: "stale-before-clear" }, attachments: {}, omittedFieldIds: [],
  });
  const originalLoad = window.webenvoyShell?.loadProtectedDraft;
  let releaseLoad: (() => void) | undefined;
  let loadStarted: (() => void) | undefined;
  const loadStartedPromise = new Promise<void>((resolve) => { loadStarted = resolve; });
  const releaseLoadPromise = new Promise<void>((resolve) => { releaseLoad = resolve; });
  if (window.webenvoyShell != null && originalLoad != null) window.webenvoyShell.loadProtectedDraft = async (context) => {
    const stale = await originalLoad(context);
    loadStarted?.();
    await releaseLoadPromise;
    return stale;
  };
  const staleLoad = loadSkillInputDraft(skill, loadRaceIdentity);
  await loadStartedPromise;
  await clearSkillInputDraft(skill, loadRaceIdentity);
  releaseLoad?.();
  const clearedLoad = await staleLoad;
  if (window.webenvoyShell != null) window.webenvoyShell.loadProtectedDraft = originalLoad;
  const originalSelect = window.webenvoyShell?.selectLocalFiles;
  if (window.webenvoyShell != null) window.webenvoyShell.selectLocalFiles = async () => ({ status: "unavailable", files: [] });
  const browserFileFallback = await selectLocalAttachments();
  if (window.webenvoyShell != null) window.webenvoyShell.selectLocalFiles = originalSelect;
  if (window.webenvoyShell != null) window.webenvoyShell.saveProtectedDraft = originalSave;
  const persisted = [...protectedDrafts.values()].find((value) => JSON.stringify(value).includes("restart-safe-identity"));
  const refreshed = await refreshLocalAttachments([{ id: "missing", localRef: "local_file_ref_00000000-0000-4000-8000-000000000002", name: "missing.txt", size: 1, type: "text/plain", lastModified: 1, state: "reselect" }]);
  const persistedText = JSON.stringify(persisted);
  if (initialErrors.body == null || initialErrors.attachments == null || excessiveFiles == null || excessive == null || duplicate == null || constant == null ||
    !JSON.stringify(persisted).includes("draft") || !JSON.stringify(persisted).includes("public.txt") ||
    /secret-token|xsec_token|synthetic-secret|secret-id/.test(persistedText) || !persistedText.includes("accessToken") ||
    !persistedText.includes("detailUrl") || !persistedText.includes("downloadUrl") || !persistedText.includes("awsUrl") ||
    !persistedText.includes("gcsUrl") || !persistedText.includes("securityId") ||
    !persistedText.includes("oauthUrl") || !persistedText.includes("fragmentSasUrl") ||
    unavailablePersistence !== "unavailable" || memoryOnlyDraft.persistence !== "unavailable" ||
    !memoryOnlyDraft.omittedFieldIds.includes("accessToken") || racedDraft.draft.values.body !== "newer" || racedDraft.persistence !== "unavailable" ||
    clearedLoad.restored || clearedLoad.draft.values.body === "stale-before-clear" || browserFileFallback !== null ||
    Object.keys(window.localStorage).some((key) => key.includes("skillInputDraft")) || refreshed[0]?.state !== "unreadable") {
    throw new Error("Draft validation, protected persistence, or attachment revalidation failed.");
  }
}

async function checkOwnerBoundaries(catalog: LodeCatalogLoadState) {
  const cache = JSON.stringify(projectLodeCatalogDisplayCache({
    ...catalog,
    credential: "top-secret",
    skills: catalog.skills.map((skill) => ({ ...skill, token: "skill-secret" })),
  } as LodeCatalogLoadState));
  const gate = createLatestRequestGate();
  const superseded = gate.begin();
  const latest = gate.begin();
  const supersededCorrectly = superseded.signal.aborted && !superseded.isCurrent() && latest.isCurrent();
  gate.invalidate();
  const safeError = projectOwnerHttpStatusError("/owner", 409, { error: { category: "owner_contract", code: "identity_not_ready", message: "Bearer raw-secret" }, token: "raw-secret" });
  const unsafeError = projectOwnerHttpStatusError("/owner", 409, { error: { category: "Bearer raw-secret", code: "token=raw-secret" } });
  const recoveries = [
    compatibilityRecoveryCopy({ identityEnvironmentRef: "a", status: "incompatible", reasonCodes: [], recoveryAction: "repair_package_contract" }),
    compatibilityRecoveryCopy({ identityEnvironmentRef: "a", status: "incompatible", reasonCodes: [], recoveryAction: "select_matching_identity" }),
    compatibilityRecoveryCopy({ identityEnvironmentRef: "a", status: "requires_setup", reasonCodes: [], recoveryAction: "install_or_select_provider" }),
    compatibilityRecoveryCopy({ identityEnvironmentRef: "a", status: "requires_setup", reasonCodes: [], recoveryAction: "connect_identity_environment" }),
    compatibilityRecoveryCopy({ identityEnvironmentRef: "a", status: "requires_setup", reasonCodes: [], recoveryAction: "repair_browser_environment" }),
    compatibilityRecoveryCopy({ identityEnvironmentRef: "a", status: "requires_setup", reasonCodes: [], recoveryAction: "open_manual_auth" }),
  ];
  const environmentFacts = identityFactsFromPublicRecord(environmentRepairPublicRecord(), providerCatalog());
  const environmentIdentity = environmentFacts == null ? null : projectHarborIdentity(environmentFacts, providerCatalog(), "2026-07-22T00:00:00Z");
  const authenticationFacts = identityFactsFromPublicRecord(authenticationRecoveryPublicRecord(), providerCatalog());
  const authenticationIdentity = authenticationFacts == null ? null : projectHarborIdentity(authenticationFacts, providerCatalog(), "2026-07-22T00:00:00Z");
  const fallbackFacts = identityFactsFromPublicRecord(healthyChromeFallbackPublicRecord(), providerCatalog());
  const fallbackIdentity = fallbackFacts == null ? null : projectHarborIdentity(fallbackFacts, providerCatalog(), "2026-07-22T00:00:00Z");
  const fallbackNoticeIdentity = fallbackFacts == null ? null : projectHarborIdentity({
    ...fallbackFacts,
    provider_binding: { ...fallbackFacts.provider_binding, warnings: ["provider_restricted_fallback"] },
  }, providerCatalog(), "2026-07-22T00:00:00Z");
  const missingStorageFacts = identityFactsFromPublicRecord(missingStoragePublicRecord(), providerCatalog());
  const missingStorageIdentity = missingStorageFacts == null ? null : projectHarborIdentity(missingStorageFacts, providerCatalog(), "2026-07-22T00:00:00Z");
  const authBlock = readOnlyIdentityAdmissionBlockReason({ ...identity, readiness: { state: "needs-auth", label: "需要登录", reasons: [] } }, "task-xhs-real-read");
  const environmentBlock = environmentIdentity == null ? null : readOnlyIdentityAdmissionBlockReason(environmentIdentity, "task-xhs-real-read");
  const failureCopies = [
    coreTaskSubmitFailureSummary({ error: { code: "browser_environment_repair_required", recovery_action: "repair_browser_environment" } }, "fallback"),
    coreTaskSubmitFailureSummary({ error: { code: "identity_auth_required", recovery_action: "open_manual_auth" } }, "fallback"),
    coreTaskSubmitFailureSummary({ error: { code: "identity_environment_unavailable", recovery_hint: "connect_identity_environment" } }, "fallback"),
  ];
  const readTask = taskThreadFixtures.find((task) => task.id === "task-xhs-real-read");
  const fixedTask = readTask == null ? null : {
    ...readTask,
    threadContext: { siteLabel: "小红书", siteSkillKey: "xhs", accountIdentityKey: identityB.identityEnvironmentRef },
  };
  const fixedReadiness = fixedTask == null ? null : coreTaskSubmitReadiness(fixedTask, runtime, [identity, identityB]);
  const missingIdentityReadiness = fixedTask == null ? null : coreTaskSubmitReadiness({
    ...fixedTask,
    threadContext: { ...fixedTask.threadContext, accountIdentityKey: "identity-env_missing" },
  }, runtime, [identity, identityB]);
  const fixtureIdentityReadiness = fixedTask == null ? null : coreTaskSubmitReadiness(fixedTask, runtime, [{
    ...identityB,
    source: "Harbor fixture",
  }]);
  const fallbackReadiness = fixedTask == null || fallbackIdentity == null ? null : coreTaskSubmitReadiness({
    ...fixedTask,
    threadContext: { ...fixedTask.threadContext, accountIdentityKey: fallbackIdentity.identityEnvironmentRef },
  }, runtime, [fallbackIdentity]);
  const missingIdentityReason = missingIdentityReadiness != null && !missingIdentityReadiness.ok ? missingIdentityReadiness.reason : "";
  let cancelled = false;
  await readBoundedJsonResponse(new Response(new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new Uint8Array(64 * 1024 + 1)); },
    cancel() { cancelled = true; },
  }), { headers: { "content-type": "application/json" } }), ownerApiResponseMaxBytes("/identity-compatibility-preview")).then(
    () => { throw new Error("Oversized owner response was accepted."); },
    () => undefined,
  );
  if (/secret|credential|token|pattern/.test(cache) || !supersededCorrectly || latest.isCurrent() ||
    safeError !== "/owner returned 409: owner_contract: identity_not_ready" || unsafeError !== "/owner returned 409" ||
    recoveries.map((item) => `${item?.destination}:${item?.label}`).join(",") !==
      "skill_repair:更新或修复站点技能,identity_selection:选择其他账号身份,identity:修复浏览器环境,identity:修复浏览器环境,identity:修复浏览器环境,identity:登录账号" ||
    environmentFacts?.login_state.human_verification.length !== 0 || environmentFacts?.credential_recovery.recovery_actions.length !== 0 ||
    environmentIdentity?.readiness.state !== "blocked" || environmentIdentity.readiness.label !== "需要修复浏览器环境" ||
    authenticationFacts?.credential_recovery.recovery_actions[0] !== "manual_login" ||
    authenticationIdentity?.readiness.state !== "needs-auth" || authenticationIdentity.readiness.label !== "需要登录或人工认证" ||
    fallbackIdentity?.readiness.state !== "warning" || fallbackNoticeIdentity?.readiness.state !== "warning" || fallbackReadiness?.ok !== true ||
    missingStorageIdentity?.readiness.state !== "blocked" || missingStorageIdentity.readiness.label !== "需要修复浏览器环境" ||
    environmentIdentity.login.recoveryRequired || environmentBlock !== "需要先修复浏览器环境；当前身份不能启动真实 Core task。" ||
    !authBlock?.includes("登录/人工认证") || failureCopies.join(",") !== "需要修复浏览器环境后重试。,需要登录或完成人工认证后重试。,需要修复浏览器环境后重试。" || !cancelled ||
    fixedReadiness?.ok !== true || fixedReadiness.payload.harbor.identity_environment_ref !== identityB.identityEnvironmentRef ||
    missingIdentityReadiness?.ok !== false || !missingIdentityReason.includes("不切换到同站点其他身份") ||
    fixtureIdentityReadiness?.ok !== false ||
    ownerApiResponseMaxBytes("/threads") <= 64 * 1024 || ownerApiResponseMaxBytes("/runtime/identity-environments") <= 64 * 1024) {
    throw new Error("Display cache, request freshness, recovery projection, or response budget boundary failed.");
  }
}

function authenticationRecoveryPublicRecord() {
  const value = environmentRepairPublicRecord();
  return {
    ...value,
    identity_environment_ref: "identity-env_dddddddddddddddddddddddd",
    status: {
      ...value.status,
      login_state: "unknown",
      manual_authentication_state: "not_required",
      authentication_provenance: null,
      blocking_reasons: ["login_state_missing"],
      repair_reasons: [],
    },
  };
}

function healthyChromeFallbackPublicRecord() {
  const value = environmentRepairPublicRecord();
  return {
    ...value,
    identity_environment_ref: "identity-env_eeeeeeeeeeeeeeeeeeeeeeee",
    status: {
      ...value.status,
      recovery_required: false,
      blocking_reasons: [],
      repair_reasons: [],
    },
  };
}

function missingStoragePublicRecord() {
  const value = healthyChromeFallbackPublicRecord();
  return {
    ...value,
    identity_environment_ref: "identity-env_ffffffffffffffffffffffff",
    status: { ...value.status, browser_storage_state: "missing" },
  };
}

function environmentRepairPublicRecord() {
  return {
    schema_version: "harbor-local-identity-environment-store/v0",
    identity_environment_ref: "identity-env_cccccccccccccccccccccccc",
    site: { site_id: "xiaohongshu", origin: "https://www.xiaohongshu.com", display_name: "小红书", account_ref: "环境修复测试号" },
    refs: { execution_identity_ref: "execution_ref_public", profile_ref: "profile_ref_public", profile_storage_ref: "storage_ref_public" },
    environment_summary: { provider_id: "chrome_official", browser_storage_state: "present", browser_family: "chrome" },
    status: {
      login_state: "logged_in",
      manual_authentication_state: "completed",
      authentication_provenance: "user_confirmed_managed_session",
      browser_storage_state: "present",
      recovery_required: true,
      blocking_reasons: ["provider_conflict", "not a bounded reason"],
      repair_reasons: ["fingerprint_conflict"],
    },
  };
}

function providerCatalog() {
  return {
    schema_version: "harbor-browser-provider-status/v0",
    providers: [{
      provider_id: "chrome_official",
      display_name: "官方 Chrome",
      role: "restricted_fallback",
      install: { status: "installed", path: null, version: "test", launchability: "launchable", reason: null },
    }],
    excluded_providers: [],
  } as const;
}
