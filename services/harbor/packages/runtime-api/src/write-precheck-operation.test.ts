import assert from "node:assert/strict";
import test from "node:test";
import { createFixtureLauncher, HarborRuntime, XHS_PUBLISH_PRECHECK_PIN, type LocalProviderLauncher } from "./index.js";
import {
  XHS_WRITE_PRECHECK_CDP_COMMANDS,
  validWritePrecheckFreshness,
  validateXhsWritePrecheckObservation,
  writePrecheckProbeExpression
} from "./local-provider-launcher.js";
import {
  XHS_PUBLISH_PATH_PREPARE_PIN,
  admitXhsPublishPrecheck,
  admitXhsPublishPathPrepare,
  completeXhsPathPrepare,
  completeWritePrecheck,
  validCompletedWritePrecheckProbe,
  WritePrecheckObservationStore
} from "./write-precheck-operation.js";
import type {
  LocalProviderWritePrecheckProbeInput,
  LocalProviderWritePrecheckProbeResult
} from "./runtime-session-types.js";
import { trustLocalProviderWritePrecheckProbe } from "./read-operation-probe-trust.js";

const input: LocalProviderWritePrecheckProbeInput = {
  target_url: "https://creator.xiaohongshu.com/publish/publish",
  expected_origin: "https://creator.xiaohongshu.com",
  target_ref: "public-draft-ref"
};

const lodeAdmissionFixture = {
  url: "https://creator.xiaohongshu.com/publish/publish?from=menu_left&target=image",
  target_ref: "writable-target:xiaohongshu/creator-publish-note",
  no_submit_guard: "active" as const,
  requested_fields: ["title", "summary", "canonical_url", "source_status"] as const,
  include_source_refs: true,
  proposed_input_summary: "校验创作中心发布页和内容编辑目标，生成草稿预览，不保存、不上传、不发布。"
};

const observation = {
  url: input.target_url,
  origin: input.expected_origin,
  pathname: "/publish/publish",
  challenge_like: false,
  login_like: false,
  creator_app_owned: true,
  creator_root_count: 1,
  upload_image_tab_active: true,
  upload_image_entry_visible: true,
  text_image_entry_visible: true
};

function completedProbe(): Extract<LocalProviderWritePrecheckProbeResult, { status: "completed" }> {
  const result = validateXhsWritePrecheckObservation(input, observation);
  if (result.status !== "completed") throw new Error("expected a completed semantic observation");
  return result;
}

test("pins and admits only the public Lode validate-only contract", () => {
  assert.equal(XHS_PUBLISH_PRECHECK_PIN.repository, "WebEnvoy/Lode");
  assert.equal(XHS_PUBLISH_PRECHECK_PIN.commit, "6bff1afd059a30571f8ed219d1dcd25e6fb20c6b");
  assert.equal(XHS_PUBLISH_PRECHECK_PIN.operation_mode, "validate_only");
  assert.deepEqual(admitXhsPublishPrecheck(lodeAdmissionFixture), {
    url: lodeAdmissionFixture.url,
    target_ref: lodeAdmissionFixture.target_ref,
    requested_fields: lodeAdmissionFixture.requested_fields,
    include_source_refs: lodeAdmissionFixture.include_source_refs,
    proposed_input_summary: lodeAdmissionFixture.proposed_input_summary
  });
  assert.deepEqual(admitXhsPublishPrecheck({
    url: input.target_url,
    target_ref: input.target_ref,
    holder_ref: "run_write_precheck",
    no_submit_guard: "active",
    requested_fields: ["title", "summary"],
    include_source_refs: true,
    proposed_input_summary: "公开草稿摘要"
  }), {
    url: input.target_url,
    target_ref: input.target_ref,
    holder_ref: "run_write_precheck",
    requested_fields: ["title", "summary"],
    include_source_refs: true,
    proposed_input_summary: "公开草稿摘要"
  });
  for (const url of [
    `${input.target_url}?q=100%25`,
    `${input.target_url}?q=%25`,
    `${input.target_url}?q=%25E4%25B8%25AD`
  ]) assert.equal(admitXhsPublishPrecheck({ url, target_ref: "ref", no_submit_guard: "active" })?.url, url);
  for (const rejected of [
    { url: "https://www.xiaohongshu.com/publish/publish", target_ref: "ref", no_submit_guard: "active" },
    { url: `${input.target_url}?token=secret`, target_ref: "ref", no_submit_guard: "active" },
    { url: `${input.target_url}#changed`, target_ref: "ref", no_submit_guard: "active" },
    { url: `https://user@creator.xiaohongshu.com/publish/publish`, target_ref: "ref", no_submit_guard: "active" },
    { url: `https://creator.xiaohongshu.com/publish`, target_ref: "ref", no_submit_guard: "active" },
    { url: input.target_url, target_ref: "cookie-token", no_submit_guard: "active" },
    { url: input.target_url, target_ref: "验证码:123456", no_submit_guard: "active" },
    { url: input.target_url, target_ref: "verification_code=123456", no_submit_guard: "active" },
    { url: input.target_url, target_ref: "ref", no_submit_guard: "active", proposed_input_summary: "secret=abc" },
    { url: input.target_url, target_ref: "ref", no_submit_guard: "active", proposed_input_summary: "验证码 123456" },
    { url: input.target_url, target_ref: "ref", no_submit_guard: "active", package_ref: XHS_PUBLISH_PRECHECK_PIN.package_ref },
    { url: input.target_url, target_ref: "ref", no_submit_guard: "active", requested_fields: ["title", "title"] }
  ]) assert.equal(admitXhsPublishPrecheck(rejected), null);
  for (const term of [
    "provider_key", "harbor_profile_id", "profile_state", "runtime_session", "runtime_session_id", "live_tab_state",
    "cookie", "cookies", "token", "tokens", "local_path", "storage_url", "proxy", "raw_evidence_body", "full_dom",
    "har", "screenshot_body", "production_payload", "user_business_data", "api_key", "access_key", "authorization",
    "auth", "jwt", "session_token", "cdp_endpoint", "viewer_url", "network_response_body"
  ]) {
    assert.equal(admitXhsPublishPrecheck({
      url: `${input.target_url}?${term}=secret`,
      target_ref: "ref",
      no_submit_guard: "active"
    }), null, term);
  }
  assert.equal(admitXhsPublishPrecheck({
    url: `${input.target_url}?raw+dom=secret`,
    target_ref: "ref",
    no_submit_guard: "active"
  }), null);
  assert.equal(admitXhsPublishPrecheck({
    url: `${input.target_url}?raw%2Bdom=secret`,
    target_ref: "ref",
    no_submit_guard: "active"
  }), null);
  assert.equal(admitXhsPublishPrecheck({
    url: `${input.target_url}?note=raw%252Bdom`,
    target_ref: "ref",
    no_submit_guard: "active"
  }), null);
  assert.equal(admitXhsPublishPrecheck({
    url: input.target_url,
    target_ref: "ref",
    no_submit_guard: "active",
    proposed_input_summary: "authorization: Bearer abc"
  }), null);
  assert.equal(admitXhsPublishPrecheck({
    url: input.target_url,
    target_ref: "ref",
    no_submit_guard: "active",
    proposed_input_summary: "raw%2Bdom"
  }), null);
  assert.equal(admitXhsPublishPrecheck({
    url: input.target_url,
    target_ref: "ref",
    no_submit_guard: "active",
    proposed_input_summary: "raw%2525252Bdom"
  }), null);
  assert.equal(admitXhsPublishPrecheck({
    url: input.target_url,
    target_ref: "ref",
    no_submit_guard: "active",
    proposed_input_summary: "raw%2Bdom%"
  }), null);
  for (const proposed_input_summary of ["raw%80%64om", "raw%ZZdom"]) {
    assert.equal(admitXhsPublishPrecheck({
      url: input.target_url,
      target_ref: "ref",
      no_submit_guard: "active",
      proposed_input_summary
    }), null);
  }
  assert.equal(admitXhsPublishPrecheck({
    url: `${input.target_url}?note=${"a".repeat(2_048)}`,
    target_ref: "ref",
    no_submit_guard: "active"
  }), null);
  assert.equal(admitXhsPublishPrecheck({
    url: `${input.target_url}?note=bad\u0000value`,
    target_ref: "ref",
    no_submit_guard: "active"
  }), null);
});

test("#405 admits both explicit paths and returns refs-only no-submit state", () => {
  for (const requested_path of ["image_text_upload", "image_text_generate"] as const) {
    const admitted = admitXhsPublishPathPrepare({
      url: `${input.target_url}?from=menu_left&target=image`,
      target_ref: "target-ref:xiaohongshu/creator-publish-page",
      no_submit_guard: "active",
      requested_path
    });
    assert.equal(admitted?.requested_path, requested_path);
    assert.equal(admitted?.url, `${input.target_url}?from=menu_left&target=image`);
  }
  for (const rejected of [
    { requested_path: "video" },
    { requested_path: "image_text_upload", no_submit_guard: "inactive" },
    { requested_path: "image_text_upload", include_source_refs: true },
    { requested_path: "image_text_upload", proposed_input_summary: "unused" },
    { requested_path: "image_text_upload", selector: "button" }
  ]) {
    assert.equal(admitXhsPublishPathPrepare({
      url: input.target_url,
      target_ref: input.target_ref,
      no_submit_guard: "active",
      ...rejected
    }), null);
  }
  const probe = completedProbe();
  const pathProbe = {
    ...probe,
    path_prepare: {
      requested_path: "image_text_generate" as const,
      observed_path: "observed" as const,
      composition_state: "initialized" as const,
      business_state_before: { route_state: "observed" as const, control_owner_state: "observed" as const, observed_path: "unknown" as const, composition_state: "unknown" as const, submitted: false as const },
      business_state_after: { route_state: "observed" as const, control_owner_state: "observed" as const, observed_path: "observed" as const, composition_state: "initialized" as const, submitted: false as const },
      interaction: { allowed_action: "exact_visible_path_control_selection" as const, requested_control: "generate_image" as const, selection_status: "selected" as const, readback_status: "read" as const },
      composition_state_proof: { basis: "business_state_readback" as const, path_entry_alone_proves_initialized: false as const },
      submitted: false as const,
      prohibited_actions_observed: { file_chooser: false as const, file_select: false as const, upload: false as const, generate: false as const, field_fill: false as const, save_draft: false as const, publish: false as const, submit: false as const, retry: false as const, bypass: false as const },
      no_submit_guard_status: "active" as const
    }
  };
  const completed = completeXhsPathPrepare("session_path_prepare", "identity_path_prepare", pathProbe);
  assert.equal(completed?.schema_version, "harbor-xhs-publish-note-path-prepare/v0");
  assert.equal(completed?.normalized.requested_path, "image_text_generate");
  assert.equal(completed?.normalized.composition_state, "initialized");
  assert.equal(completed?.normalized.composition_state_proof.path_entry_alone_proves_initialized, false);
  assert.equal(completed?.submitted, false);
  assert.equal(completed?.evidence_refs[0]?.ref, pathProbe.evidence_ref_kinds[0]?.ref);
  assert.deepEqual(completed?.post_check.source_refs, completed?.source_refs);
  assert.deepEqual(completed?.post_check.evidence_refs, completed?.evidence_refs);
  assert.equal(completed?.post_check.requested_path, completed?.normalized.requested_path);
  assert.equal(completed?.post_check.observed_path, completed?.normalized.observed_path);
  assert.equal(completed?.post_check.composition_state, completed?.normalized.composition_state);
  assert.deepEqual(completed?.post_check.business_state_after, completed?.normalized.business_state_after);
  assert.equal(completed?.post_check.no_submit_guard_status, "active");
  assert.equal(completed?.lode_pin.package_ref, XHS_PUBLISH_PATH_PREPARE_PIN.package_ref);
  assert.equal(completed?.public_boundary.external_write_actions, "not_performed");
});

test("keeps the browser probe read-only and freshness-bound", () => {
  assert.deepEqual(XHS_WRITE_PRECHECK_CDP_COMMANDS, ["Runtime.enable", "Runtime.evaluate", "Page.enable", "Page.captureScreenshot", "Page.setInterceptFileChooserDialog"]);
  assert.equal(XHS_WRITE_PRECHECK_CDP_COMMANDS.some((command) => command.startsWith("Fetch.")), false);
  const expression = writePrecheckProbeExpression();
  for (const mutation of [".click(", ".value=", "dispatchEvent", "execCommand", "location.assign", ".submit("]) {
    assert.equal(expression.includes(mutation), false, mutation);
  }
  assert.match(expression, /上传图文/);
  assert.match(expression, /上传图片/);
  assert.match(expression, /文字配图/);
  assert.equal(expression.includes("hasLabel([/^上传图文$/]"), false);
  assert.equal(expression.includes("querySelectorAll('main"), false);
  assert.equal(expression.includes("semanticText"), false);
  assert.equal(expression.includes("bodyText.includes('创作者')"), false);
  assert.equal(expression.includes("creatorControls.length >= 2"), false);
  assert.match(expression, /selectedRequestedPath/);
  assert.match(expression, /findControl = \(patterns, includeDisabled = false/);
  assert.equal(validWritePrecheckFreshness(input, observation, observation, 1_000, 2_999), true);
  assert.equal(validWritePrecheckFreshness(input, observation, { ...observation, login_like: true }, 1_000, 2_000), false);
  assert.equal(validWritePrecheckFreshness(input, observation, observation, 1_000, 3_001), false);
});

test("accepts dynamic composition observations without mistaking selector drift for a non-writable target", () => {
  const initialized = validateXhsWritePrecheckObservation(
    { ...input, composition_path: "image_text_upload" },
    {
      ...observation,
      upload_image_tab_active: false,
      upload_image_entry_visible: false,
      text_image_entry_visible: false,
      composition_path: "image_text_upload",
      path_observed: "observed",
      path_entry_visible: "observed",
      composition_state: "composition_initialized",
      field_states: {
        title_input: { availability: "available", observation: "observed", editable: "observed", value_state: "empty" },
        content_editor: { availability: "available", observation: "observed", editable: "observed", value_state: "empty" },
        publish_control: { availability: "available", observation: "observed", editable: "observed" }
      },
      media_state: {
        availability: "available",
        observation: "observed",
        controls: { upload_image: { availability: "available", observation: "observed", editable: "observed" } }
      },
      validation_state: { availability: "unknown", observation: "unknown" },
      save_draft_control: { availability: "available", observation: "observed", editable: "observed" },
      publish_control: { availability: "available", observation: "observed", editable: "observed" }
    }
  );
  assert.equal(initialized.status, "completed");
  if (initialized.status === "completed") {
    assert.equal(initialized.composition_path, "image_text_upload");
    assert.equal(initialized.precheck_scope, "composition_observation");
    assert.equal(initialized.composition_state, "composition_initialized");
    assert.equal(initialized.field_states.title_input?.availability, "available");
    assert.equal(initialized.media_state.observation, "observed");
    assert.equal(initialized.prohibited_actions_observed.upload, false);
  }

  const unknown = validateXhsWritePrecheckObservation(
    { ...input, composition_path: "video" },
    {
      ...observation,
      creator_app_owned: true,
      creator_root_count: 2,
      upload_image_tab_active: false,
      upload_image_entry_visible: false,
      text_image_entry_visible: false,
      composition_path: "video",
      path_observed: "unknown",
      path_entry_visible: "unknown",
      composition_state: "composition_unknown"
    }
  );
  assert.equal(unknown.status, "completed");
  if (unknown.status === "completed") {
    assert.equal(unknown.composition_path, "video");
    assert.equal(unknown.composition_state, "composition_unknown");
    assert.equal(unknown.entrypoint_observations.path_observed, "unknown");
    assert.equal(unknown.field_states.title_input?.observation, "unknown");
  }

  // Two unselected path-looking buttons without a semantic root are exposed
  // as unknown by the probe; the validator must not promote that fallback to
  // an owned creator surface.
  const selectorDrift = validateXhsWritePrecheckObservation(input, {
    ...observation,
    creator_app_owned: false,
    creator_root_count: 0,
    creator_surface_state: "unknown",
    upload_image_tab_active: false,
    upload_image_entry_visible: false,
    text_image_entry_visible: false
  });
  assert.deepEqual(
    selectorDrift.status === "unavailable" ? selectorDrift.failure_class : undefined,
    "evidence_unavailable"
  );

  const explicitAbsent = validateXhsWritePrecheckObservation(input, {
    ...observation,
    creator_app_owned: false,
    creator_root_count: 0,
    creator_surface_state: "absent",
    upload_image_tab_active: false,
    upload_image_entry_visible: false,
    text_image_entry_visible: false
  });
  assert.equal(explicitAbsent.status === "unavailable" ? explicitAbsent.failure_class : undefined, "target_not_writable");
});

test("keeps all catalog composition paths bounded and read-only", () => {
  for (const path of ["image_text_upload", "image_text_generate", "video", "long_article", "podcast"] as const) {
    const expression = writePrecheckProbeExpression(path);
    assert.match(expression, new RegExp(path));
    for (const mutation of [".click(", ".value=", "dispatchEvent", "execCommand", "location.assign", ".submit("]) {
      assert.equal(expression.includes(mutation), false, `${path}:${mutation}`);
    }
    assert.equal(admitXhsPublishPrecheck({ ...lodeAdmissionFixture, composition_path: path })?.composition_path, path);
  }
  assert.equal(admitXhsPublishPrecheck({ ...lodeAdmissionFixture, composition_path: "arbitrary-selector" }), null);
});

test("drops and rejects field or media keys outside the bounded observation shape", () => {
  const result = completedProbe();
  const withExtraField = {
    ...result,
    field_states: { ...result.field_states, unexpected: { availability: "unknown", observation: "unknown" } }
  } as typeof result;
  assert.equal(validCompletedWritePrecheckProbe(withExtraField), false);
  const withInnerExtraField = {
    ...result,
    field_states: {
      ...result.field_states,
      title_input: { ...result.field_states.title_input, detail: "unexpected" }
    }
  } as typeof result;
  assert.equal(validCompletedWritePrecheckProbe(withInnerExtraField), false);
  const withExtraMediaControl = {
    ...result,
    media_state: {
      ...result.media_state,
      controls: { ...result.media_state.controls, unexpected: { availability: "unknown", observation: "unknown" } }
    }
  } as typeof result;
  assert.equal(validCompletedWritePrecheckProbe(withExtraMediaControl), false);
  const sanitized = validateXhsWritePrecheckObservation(input, {
    ...observation,
    composition_path: "image_text_upload",
    field_states: {
      title_input: { availability: "unknown", observation: "unknown" },
      content_editor: { availability: "unknown", observation: "unknown" },
      publish_control: { availability: "unknown", observation: "unknown" },
      unexpected: { availability: "available", observation: "observed" }
    },
    media_state: {
      availability: "unknown",
      observation: "unknown",
      controls: { upload_image: { availability: "unknown", observation: "unknown" }, unexpected: { availability: "available", observation: "observed" } }
    }
  });
  assert.equal(sanitized.status, "completed");
  if (sanitized.status === "completed") {
    assert.equal("unexpected" in sanitized.field_states, false);
    assert.equal("unexpected" in (sanitized.media_state.controls ?? {}), false);
  }
});

test("returns refs-only submitted=false evidence and fails fixtures closed", async () => {
  const completed = completeWritePrecheck("session_ref", "identity_ref", completedProbe());
  assert.equal(validCompletedWritePrecheckProbe(completedProbe()), true);
  assert.equal(completed.submitted, false);
  assert.equal(completed.post_check.submitted, false);
  assert.equal(completed.public_boundary.external_write_actions, "not_performed");
  assert.equal(JSON.stringify(completed).match(/raw_dom|screenshot_body|credentials/g)?.length, 3);

  const observations = new WritePrecheckObservationStore();
  observations.record(completed);
  for (const ref of [completed.operation_ref, completed.page_ref, completed.result_ref, completed.submitted_result_ref, completed.post_check.post_check_ref]) {
    assert.equal(observations.get(ref)?.submitted, false);
  }

  const runtime = new HarborRuntime(createFixtureLauncher("ready"));
  const session = await runtime.createSession({ url: input.target_url });
  const unavailable = await runtime.executeXhsPublishPrecheck(session.runtime_session_ref, {
    url: input.target_url,
    target_ref: input.target_ref,
    no_submit_guard: "active"
  });
  assert.deepEqual(
    { status: unavailable.status, failure_class: "failure_class" in unavailable ? unavailable.failure_class : null, submitted: unavailable.submitted },
    { status: "unavailable", failure_class: "login_required", submitted: false }
  );
});

test("fails closed when session control changes during the trusted probe", async () => {
  let runtime: HarborRuntime;
  let sessionRef = "";
  let changeControl = false;
  const launcher: LocalProviderLauncher = async (launch) => ({
    status: "ready",
    execution_surface: "local_provider",
    cdp_ref: "cdp_test",
    viewer_entry: {
      availability: "available",
      access_mode: "interactive",
      transport: "local_window",
      input_capabilities: ["keyboard_mouse"]
    },
    page: { current_url: launch.url, title: "Creator publish", status: "ready", facts: [] },
    facts: [],
    openUrl: async (url) => ({ current_url: url, title: "Creator publish", status: "ready", facts: [] }),
    probeWritePrecheck: trustLocalProviderWritePrecheckProbe(async () => {
      if (changeControl) {
        runtime.releaseSession(sessionRef, { control_owner: "core_task" });
        runtime.lockSession(sessionRef, { control_owner: "core_task", holder_ref: "write_run" });
      }
      return completedProbe();
    }),
    captureScreenshot: async () => ({
      screenshot_ref: "screenshot_test",
      mime_type: "image/png",
      byte_length: 1,
      sha256: "00",
      captured_at: new Date().toISOString(),
      facts: []
    }),
    close: async () => undefined
  });
  runtime = new HarborRuntime(launcher);
  const identity = runtime.createLocalIdentityEnvironment({
    platform: "darwin",
    arch: "arm64",
    home_dir: "/Users/test",
    env: {},
    path_exists: (path) => path === "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    is_executable: (path) => path === "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    read_text: () => null,
    identity_environment_ref: "identity-env_xhs-write-precheck",
    execution_identity_ref: "execution-identity_xhs-write-precheck",
    profile_ref: "profile_xhs-write-precheck",
    profile_storage_ref: "profile-storage_xhs-write-precheck",
    site: { site_id: "xiaohongshu", origin: "https://www.xiaohongshu.com", display_name: "小红书" },
    login_state: "manual_auth_required",
    storage_state: "present"
  });
  assert.equal(identity.identity_environment_ref, "identity-env_xhs-write-precheck");
  const opened = await runtime.openManagedIdentityEnvironmentSession({
    identity_environment_ref: "identity-env_xhs-write-precheck",
    url: input.target_url,
    control_owner: "user",
    headless: false
  });
  if ("status" in opened) throw new Error(`managed write-precheck session should open: ${JSON.stringify(opened)}`);
  sessionRef = opened.runtime_session_ref;
  runtime.recordHandoff(sessionRef, { control_owner: "user", handoff_reason: "login_required" });
  const authenticated = runtime.completeManualAuthentication(sessionRef);
  if (authenticated.status === "unavailable") throw new Error(`managed write-precheck session should authenticate: ${JSON.stringify(authenticated)}`);
  assert.equal(authenticated.status.authentication_provenance, "user_confirmed_managed_session");
  runtime.recordHandoff(sessionRef, { control_owner: "core_task", handoff_reason: "user_requested" });
  const mismatchedHolder = await runtime.executeXhsPublishPrecheck(sessionRef, {
    url: input.target_url,
    target_ref: input.target_ref,
    holder_ref: "wrong_run",
    no_submit_guard: "active"
  });
  assert.deepEqual(
    { status: mismatchedHolder.status, failure_class: "failure_class" in mismatchedHolder ? mismatchedHolder.failure_class : null },
    { status: "unavailable", failure_class: "session_user_controlled" }
  );
  runtime.releaseSession(sessionRef, { control_owner: "core_task" });
  runtime.lockSession(sessionRef, { control_owner: "core_task", holder_ref: "write_run" });

  const request = { url: input.target_url, target_ref: input.target_ref, holder_ref: "write_run", no_submit_guard: "active" };
  assert.equal((await runtime.executeXhsPublishPrecheck(sessionRef, request)).status, "completed");
  changeControl = true;
  const drifted = await runtime.executeXhsPublishPrecheck(sessionRef, request);
  assert.deepEqual(
    { status: drifted.status, failure_class: "failure_class" in drifted ? drifted.failure_class : null, submitted: drifted.submitted },
    { status: "unavailable", failure_class: "session_user_controlled", submitted: false }
  );
});

test("fails closed before probing when a managed XHS identity has an unpinned origin", async () => {
  let probeCalls = 0;
  const launcher: LocalProviderLauncher = async (launch) => ({
    status: "ready",
    execution_surface: "local_provider",
    cdp_ref: "cdp_test",
    viewer_entry: {
      availability: "available",
      access_mode: "interactive",
      transport: "local_window",
      input_capabilities: ["keyboard_mouse"]
    },
    page: { current_url: launch.url, title: "Creator publish", status: "ready", facts: [] },
    facts: [],
    openUrl: async (url) => ({ current_url: url, title: "Creator publish", status: "ready", facts: [] }),
    probeWritePrecheck: trustLocalProviderWritePrecheckProbe(async () => {
      probeCalls += 1;
      return completedProbe();
    }),
    captureScreenshot: async () => ({
      screenshot_ref: "screenshot_test",
      mime_type: "image/png",
      byte_length: 1,
      sha256: "00",
      captured_at: new Date().toISOString(),
      facts: []
    }),
    close: async () => undefined
  });
  const runtime = new HarborRuntime(launcher);
  runtime.createLocalIdentityEnvironment({
    platform: "darwin",
    arch: "arm64",
    home_dir: "/Users/test",
    env: {},
    path_exists: (path) => path === "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    is_executable: (path) => path === "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    read_text: () => null,
    identity_environment_ref: "identity-env_xhs-write-precheck-origin-drift",
    execution_identity_ref: "execution-identity_xhs-write-precheck-origin-drift",
    profile_ref: "profile_xhs-write-precheck-origin-drift",
    profile_storage_ref: "profile-storage_xhs-write-precheck-origin-drift",
    site: { site_id: "xiaohongshu", origin: "https://attacker.example", display_name: "小红书" },
    login_state: "manual_auth_required",
    storage_state: "present"
  });
  const opened = await runtime.openManagedIdentityEnvironmentSession({
    identity_environment_ref: "identity-env_xhs-write-precheck-origin-drift",
    url: input.target_url,
    control_owner: "user",
    headless: false
  });
  if ("status" in opened) throw new Error(`managed write-precheck session should open: ${JSON.stringify(opened)}`);
  runtime.recordHandoff(opened.runtime_session_ref, { control_owner: "user", handoff_reason: "login_required" });
  const authenticated = runtime.completeManualAuthentication(opened.runtime_session_ref);
  if (authenticated.status === "unavailable") throw new Error(`managed write-precheck session should authenticate: ${JSON.stringify(authenticated)}`);
  runtime.recordHandoff(opened.runtime_session_ref, { control_owner: "core_task", handoff_reason: "user_requested" });

  const result = await runtime.executeXhsPublishPrecheck(opened.runtime_session_ref, {
    url: input.target_url,
    target_ref: input.target_ref,
    no_submit_guard: "active"
  });
  assert.deepEqual(
    { status: result.status, failure_class: "failure_class" in result ? result.failure_class : null, submitted: result.submitted },
    { status: "unavailable", failure_class: "login_required", submitted: false }
  );
  assert.equal(probeCalls, 0);
});
