import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import {
  admitAllowlistedReadOperation,
  canonicalPinnedMirrorSha256,
  LODE_262_ALLOWLIST_PIN,
  LODE_268_DETAIL_PIN,
  ReadOperationObservationStore,
  validateDetailTruthPin,
  validatePinnedAllowlist
} from "./read-operation.js";
import { opaqueRef } from "./refs.js";
import { probeProviderSiteResource, readOperationPageFacts, readProbeExpression, shouldBlockReadOperationDocumentNavigation, summarizeBossJobDetailResponse, summarizeBossJobSearchResponse, summarizeXhsSearchResponse, validateBossSpaResourceProbe, validateReadOperationProbe, validateXiaohongshuSiteResourceProbe, waitForXiaohongshuSiteResourceReadiness, xiaohongshuSiteResourceProbeExpression } from "./local-provider-launcher.js";

test("pins the packaged Harbor admission mirror to Lode #262", () => {
  assert.equal(LODE_262_ALLOWLIST_PIN.repository, "WebEnvoy/Lode");
  assert.equal(LODE_262_ALLOWLIST_PIN.commit, "e36a4a7");
  assert.equal(LODE_262_ALLOWLIST_PIN.asset_path, "registry/runtime-consumption-allowlist.json");
  assert.equal(LODE_262_ALLOWLIST_PIN.asset_sha256, "5aa6be8bd416bbd19f73dcfab995f62f769849923f2aa2e995da974b0f329184");
  assert.equal(canonicalPinnedMirrorSha256(), LODE_262_ALLOWLIST_PIN.mirror_payload_sha256);
  assert.equal(validatePinnedAllowlist(), null);
  assert.equal(validatePinnedAllowlist({ entries: [] }), "allowlist_pin_invalid");
});

test("pins detail admission and completion to merged Lode #268 truth", () => {
  assert.equal(LODE_268_DETAIL_PIN.merge_commit, "66d79b4e600565a00515b1c801e84291edc7b0c1");
  assert.equal(LODE_268_DETAIL_PIN.asset_path, "registry/detail-runtime-consumption.json");
  assert.equal(LODE_268_DETAIL_PIN.asset_sha256, "dca2761b7feb09a0ab86f7202e153da3c97b21a75299af6adaf64eade319deef");
  assert.equal(LODE_268_DETAIL_PIN.truth_id, "lode.xhs-boss.detail-read.runtime-consumption");
  assert.equal(validateDetailTruthPin(), null);
  const xhs = admitAllowlistedReadOperation({ site_id: "xiaohongshu", operation_id: "xhs_read_note_detail", detail_ref: opaqueRef("detail_ref") });
  if (typeof xhs === "string") throw new Error("Corrected XHS detail truth was rejected.");
  assert.deepEqual(xhs.entry.required_source_ref_kinds, ["pinia_store_summary", "network_summary", "dom_snapshot_summary"]);
  assert.deepEqual(xhs.entry.required_evidence_ref_kinds, ["snapshot_ref", "post_check_ref"]);
  const boss = admitAllowlistedReadOperation({ site_id: "boss", operation_id: "boss_read_job_detail", detail_ref: opaqueRef("detail_ref") });
  if (typeof boss === "string") throw new Error("Corrected BOSS detail truth was rejected.");
  assert.equal(boss.entry.package_ref, "lode://site-capability/boss/read-job-detail@0.1.1");
  assert.equal(boss.entry.lock_ref, "lode://lock/site-capability/boss/read-job-detail@0.1.1");
  assert.equal(boss.entry.version, "0.1.1");
  assert.deepEqual(boss.entry.required_source_ref_kinds, ["wapi_job_detail_summary", "dom_snapshot_summary"]);
  assert.deepEqual(boss.entry.required_evidence_ref_kinds, ["snapshot_ref"]);
});

test("admits only the two pinned read-only operation identities", () => {
  const xiaohongshu = admitAllowlistedReadOperation({
    site_id: "xiaohongshu",
    operation_id: "xhs_search_notes",
    query: "AI tools"
  });
  assert.equal(typeof xiaohongshu === "string", false);
  if (typeof xiaohongshu === "string") throw new Error("Pinned Xiaohongshu operation was unexpectedly rejected.");
  assert.equal(xiaohongshu.entry.operation_mode, "read");
  assert.equal(xiaohongshu.entry.lock_ref, "lode://lock/site-capability/xiaohongshu/search-notes@0.1.0");
  assert.equal(xiaohongshu.target_url, "https://www.xiaohongshu.com/search_result?keyword=AI+tools&source=web_search_result_notes");

  const boss = admitAllowlistedReadOperation({ site_id: "boss", operation_id: "boss_job_search", query: "AI tools", city_code: "101010100" });
  assert.equal(typeof boss === "string", false);
  if (typeof boss === "string") throw new Error("Pinned BOSS operation was unexpectedly rejected.");
  assert.equal(boss.target_url, "https://www.zhipin.com/web/geek/job?query=AI+tools&city=101010100");
  assert.equal(admitAllowlistedReadOperation({ site_id: "boss", operation_id: "boss_job_search", query: "AI tools" }), "city_unresolved");
  assert.equal(admitAllowlistedReadOperation({ site_id: "boss", operation_id: "boss_job_search", query: "AI tools", city_code: "beijing" }), "city_unresolved");

  assert.equal(admitAllowlistedReadOperation({ site_id: "xiaohongshu", operation_id: "xhs_publish_note", query: "AI tools" }), "invalid_request");
  assert.equal(admitAllowlistedReadOperation({ site_id: "boss", operation_id: "boss_job_search", query: "AI tools", operation_mode: "write" }), "invalid_request");

  const noteDetail = admitAllowlistedReadOperation({ site_id: "xiaohongshu", operation_id: "xhs_read_note_detail", detail_ref: opaqueRef("detail_ref") });
  assert.equal(typeof noteDetail === "string", false);
  const jobDetail = admitAllowlistedReadOperation({ site_id: "boss", operation_id: "boss_read_job_detail", detail_ref: opaqueRef("detail_ref") });
  assert.equal(typeof jobDetail === "string", false);
  assert.equal(admitAllowlistedReadOperation({ site_id: "boss", operation_id: "boss_read_job_detail", detail_ref: opaqueRef("detail_ref"), url: "https://www.zhipin.com/job_detail/forged.html" }), "invalid_request");
  assert.equal(admitAllowlistedReadOperation({ site_id: "xiaohongshu", operation_id: "xhs_read_note_detail", query: "forged-id" }), "invalid_request");
});

test("fails closed for invalid target URLs and cross-origin requests", () => {
  for (const pathname of ["/search_result", "/search_result/"]) {
    const url = `https://www.xiaohongshu.com${pathname}?keyword=AI+tools&source=web_search_result_notes`;
    const sourcedSearch = admitAllowlistedReadOperation({
      site_id: "xiaohongshu",
      operation_id: "xhs_search_notes",
      query: "AI tools",
      url
    });
    assert.equal(
      typeof sourcedSearch === "string" ? sourcedSearch : sourcedSearch.target_url,
      `https://www.xiaohongshu.com${pathname}?keyword=AI+tools&source=web_search_result_notes`
    );
  }
  for (const suffix of ["source=forged", "source=web_search_result_notes&source=web_search_result_notes", "source=web_search_result_notes&extra=1"]) {
    assert.equal(
      admitAllowlistedReadOperation({
        site_id: "xiaohongshu",
        operation_id: "xhs_search_notes",
        query: "AI tools",
        url: `https://www.xiaohongshu.com/search_result?keyword=AI+tools&${suffix}`
      }),
      "target_path_not_allowlisted"
    );
  }
  assert.equal(
    admitAllowlistedReadOperation({
      site_id: "xiaohongshu",
      operation_id: "xhs_search_notes",
      query: "美食",
      url: "https://www.xiaohongshu.com/search_result?keyword=%25E7%25BE%258E%25E9%25A3%259F&source=web_search_result_notes"
    }),
    "target_path_not_allowlisted"
  );
  assert.equal(
    admitAllowlistedReadOperation({ site_id: "boss", operation_id: "boss_job_search", query: "AI tools", city_code: "101010100", url: "http://www.zhipin.com/web/geek/jobs" }),
    "target_url_invalid"
  );
  assert.equal(
    admitAllowlistedReadOperation({ site_id: "boss", operation_id: "boss_job_search", query: "AI tools", city_code: "101010100", url: "https://www.zhipin.com.evil.test/web/geek/jobs" }),
    "target_origin_not_allowed"
  );
  for (const path of ["/publish", "/chat", "/profile"]) {
    assert.equal(
      admitAllowlistedReadOperation({ site_id: "xiaohongshu", operation_id: "xhs_search_notes", query: "AI tools", url: `https://www.xiaohongshu.com${path}` }),
      "target_path_not_allowlisted"
    );
  }
  assert.equal(
    admitAllowlistedReadOperation({ site_id: "boss", operation_id: "boss_job_search", query: "AI tools", city_code: "101010100", url: "https://www.zhipin.com/web/geek/profile" }),
    "target_path_not_allowlisted"
  );
  assert.equal(
    admitAllowlistedReadOperation({ site_id: "boss", operation_id: "boss_job_search", query: "AI tools", city_code: "101010100", url: "https://www.zhipin.com/web/geek/jobs?query=AI+tools&city=101010100" }),
    "target_path_not_allowlisted"
  );
});

test("blocks cross-origin document redirects before navigation while allowing same-origin resources", () => {
  assert.equal(shouldBlockReadOperationDocumentNavigation("Document", "https://www.xiaohongshu.com/search_result?keyword=AI", "https://www.xiaohongshu.com"), false);
  assert.equal(shouldBlockReadOperationDocumentNavigation("Document", "https://evil.example/redirect", "https://www.xiaohongshu.com"), true);
  assert.equal(shouldBlockReadOperationDocumentNavigation("Document", "not a URL", "https://www.xiaohongshu.com"), true);
  assert.equal(shouldBlockReadOperationDocumentNavigation("Script", "https://cdn.example/app.js", "https://www.xiaohongshu.com"), false);
});

test("accepts only a rendered canonical BOSS SPA surface for pre-admission", () => {
  const ready = validateBossSpaResourceProbe({
    origin: "https://www.zhipin.com",
    pathname: "/web/geek/job",
    ready: true,
    rendered_surface: true,
    vue_owned: true,
    job_card_count: 1,
    job_cards_valid: true,
    login_like: false,
    challenge_like: false
  });
  assert.equal(ready.status, "available");
  assert.equal("evidence_ref" in ready, true);

  const cases = [
    [{ origin: "https://www.zhipin.com", pathname: "/web/user/", ready: true, rendered_surface: false, login_like: true }, "blocked", "not_logged_in"],
    [{ origin: "https://www.zhipin.com", pathname: "/security/verify", ready: true, rendered_surface: false, challenge_like: true }, "blocked", "safety_challenge"],
    [{ origin: "null", pathname: "blank", ready: false, rendered_surface: false }, "unavailable", "page_not_ready"],
    [{ origin: "https://www.zhipin.com", pathname: "/web/geek/job", ready: true, rendered_surface: false }, "unavailable", "page_not_ready"],
    [undefined, "unknown", "provider_probe_unavailable"]
  ] as const;
  for (const [observation, status, failureClass] of cases) {
    const result = validateBossSpaResourceProbe(observation);
    assert.equal(result.status, status);
    assert.equal("failure_class" in result ? result.failure_class : null, failureClass);
  }
});

test("observes only bounded XHS app readiness for site-resource admission", () => {
  const privateStore = { _s: new Map([["search", { private: "must-not-return" }]]) };
  const app = { __vue_app__: { config: { globalProperties: { $pinia: privateStore } } } };
  const document = {
    readyState: "complete",
    body: { innerText: "公开页面" },
    querySelector: (selector: string) => selector === "#app" ? app : null,
    querySelectorAll: () => []
  };
  const evaluate = new Function("window", "document", "location", `return ${xiaohongshuSiteResourceProbeExpression()}`);
  const observation = evaluate({}, document, {
    origin: "https://www.xiaohongshu.com",
    pathname: "/explore/0123456789abcdef01234567"
  });
  assert.deepEqual(observation, {
    origin: "https://www.xiaohongshu.com",
    ready: true,
    login_like: false,
    challenge_like: false,
    vue_ready: true,
    pinia_ready: true
  });
  assert.equal(JSON.stringify(observation).includes("must-not-return"), false);
});

test("maps only verified XHS readiness and keeps unsafe surfaces fail-closed", () => {
  const ready = validateXiaohongshuSiteResourceProbe({
    origin: "https://www.xiaohongshu.com",
    ready: true,
    login_like: false,
    challenge_like: false,
    vue_ready: true,
    pinia_ready: true
  });
  assert.equal(ready.status, "available");
  assert.deepEqual(ready.verified_fact_keys, ["page.vue_app.ready", "page.pinia_store.ready"]);

  const partial = validateXiaohongshuSiteResourceProbe({
    origin: "https://www.xiaohongshu.com",
    ready: true,
    login_like: false,
    challenge_like: false,
    vue_ready: true,
    pinia_ready: false
  });
  assert.equal(partial.status, "unavailable");
  assert.deepEqual(partial.verified_fact_keys, ["page.vue_app.ready"]);
  assert.equal("evidence_ref" in partial, true);

  for (const [observation, status, failureClass] of [
    [{ origin: "https://www.xiaohongshu.com", ready: true, vue_ready: true, pinia_ready: true, login_like: true }, "blocked", "not_logged_in"],
    [{ origin: "https://www.xiaohongshu.com", ready: true, vue_ready: true, pinia_ready: true, challenge_like: true }, "blocked", "safety_challenge"],
    [{ origin: "https://attacker.example", ready: true, vue_ready: true, pinia_ready: true }, "unavailable", "page_not_ready"],
    [undefined, "unknown", "provider_probe_unavailable"]
  ] as const) {
    const result = validateXiaohongshuSiteResourceProbe(observation);
    assert.equal(result.status, status);
    assert.equal("failure_class" in result ? result.failure_class : null, failureClass);
    assert.deepEqual(result.verified_fact_keys, []);
  }
});

test("waits within the bounded probe for a canonical XHS page to finish initializing", async () => {
  let observations = 0;
  const signal = new AbortController().signal;
  const result = await waitForXiaohongshuSiteResourceReadiness(async () => {
    observations += 1;
    return {
      origin: "https://www.xiaohongshu.com",
      ready: true,
      login_like: false,
      challenge_like: false,
      vue_ready: observations > 1,
      pinia_ready: observations > 2
    };
  }, signal, 0);

  assert.equal(observations, 3);
  assert.equal(result.status, "available");
  assert.deepEqual(result.verified_fact_keys, ["page.vue_app.ready", "page.pinia_store.ready"]);
});

test("does not retry XHS readiness when the observation is not a safe initialization wait", async () => {
  for (const observation of [
    undefined,
    { origin: "https://attacker.example", ready: true, login_like: false, challenge_like: false, vue_ready: false, pinia_ready: false },
    { origin: "https://www.xiaohongshu.com", ready: false, login_like: false, challenge_like: false, vue_ready: false, pinia_ready: false },
    { origin: "https://www.xiaohongshu.com", ready: true, login_like: true, challenge_like: false, vue_ready: false, pinia_ready: false },
    { origin: "https://www.xiaohongshu.com", ready: true, login_like: false, challenge_like: true, vue_ready: false, pinia_ready: false }
  ] as const) {
    let observations = 0;
    const signal = new AbortController().signal;
    await waitForXiaohongshuSiteResourceReadiness(async () => {
      observations += 1;
      return observation;
    }, signal, 0);
    assert.equal(observations, 1);
  }
});

test("stops XHS readiness evaluation on observer failure, abort, or timeout", async () => {
  let observerFailures = 0;
  await assert.rejects(waitForXiaohongshuSiteResourceReadiness(async () => {
    observerFailures += 1;
    throw new Error("controlled CDP observation failed");
  }, new AbortController().signal, 0), /controlled CDP observation failed/);
  assert.equal(observerFailures, 1);

  for (const reason of [
    new DOMException("cancelled", "AbortError"),
    new DOMException("timed out", "TimeoutError")
  ]) {
    const controller = new AbortController();
    let observations = 0;
    await assert.rejects(waitForXiaohongshuSiteResourceReadiness(async () => {
      observations += 1;
      controller.abort(reason);
      return {
        origin: "https://www.xiaohongshu.com",
        ready: true,
        login_like: false,
        challenge_like: false,
        vue_ready: false,
        pinia_ready: false
      };
    }, controller.signal, 0), (error: unknown) => error === reason);
    assert.equal(observations, 1);
  }

  const preAborted = new AbortController();
  preAborted.abort(new DOMException("cancelled", "AbortError"));
  let preAbortedObservations = 0;
  await assert.rejects(waitForXiaohongshuSiteResourceReadiness(async () => {
    preAbortedObservations += 1;
    return undefined;
  }, preAborted.signal, 0), { name: "AbortError" });
  assert.equal(preAbortedObservations, 0);
});

test("correlates the official Vue Pinia search store without exposing store contents", () => {
  const query = "AI \"tools\"; throw new Error('injected'); //\\nnext";
  const evaluate = new Function("window", "document", "location", `return ${readProbeExpression("xiaohongshu", query)}`);
  const noteIds = ["0123456789abcdef01234567", "89abcdef0123456701234567"];
  const publicItems = noteIds.map((_, index) => ({
    title: `公开笔记 ${index + 1}`,
    author_display_name: `公开作者 ${index + 1}`,
    interaction_metrics: { likes: String(10 + index), comments: String(2 + index), collects: String(3 + index) }
  }));
  const noteFeed = (id: string, index: number) => ({
    noteCard: {
      id,
      displayTitle: publicItems[index]!.title,
      user: { nickname: publicItems[index]!.author_display_name },
      interactInfo: { likedCount: 10 + index, commentCount: 2 + index, collectedCount: 3 + index }
    },
    xsec_token: "opaque-navigation-token="
  });
  const pinia = {
    _s: new Map([["search", {
      searchValue: { value: query },
      feeds: { value: noteIds.map(noteFeed) },
      hasMore: { value: true },
      private: "not_returned"
    }]])
  };
  const anchors = noteIds.map((id) => ({ getAttribute: () => `/explore/${id}` }));
  const document = {
    readyState: "complete",
    body: { innerText: "公开搜索结果" },
    querySelector: (selector: string) => selector === "#app" ? { __vue_app__: { config: { globalProperties: { $pinia: pinia } } } } : null,
    querySelectorAll: (selector: string) => selector === 'a[href*="/explore/"]' ? anchors : []
  };
  const result = evaluate({}, document, {
    origin: "https://www.xiaohongshu.com",
    pathname: "/search_result",
    search: `?keyword=${encodeURIComponent(query)}`
  });
  assert.deepEqual(result, {
    origin: "https://www.xiaohongshu.com",
    pathname: "/search_result",
    search: `?keyword=${encodeURIComponent(query)}`,
    ready: true,
    pinia_ready: true,
    list_valid: true,
    list_failure: undefined,
    note_count: 2,
    detail_urls: noteIds.map((id) => `https://www.xiaohongshu.com/explore/${id}?xsec_token=opaque-navigation-token%3D&xsec_source=pc_search`),
    search_items: publicItems,
    login_like: false,
    challenge_like: false
  });
  const challengeOverlay = {
    getBoundingClientRect: () => ({ width: 640, height: 360, top: 100, left: 100, right: 740, bottom: 460 })
  };
  const challengeDocument = ({
    display = "block",
    visibility = "visible",
    opacity = "1",
    rect = challengeOverlay.getBoundingClientRect(),
    text = "公开搜索结果"
  }: {
    display?: "block" | "none";
    visibility?: "visible" | "hidden";
    opacity?: "1" | "0";
    rect?: ReturnType<typeof challengeOverlay.getBoundingClientRect>;
    text?: string;
  } = {}) => ({
    ...document,
    body: { innerText: text },
    defaultView: {
      innerWidth: 1280,
      innerHeight: 720,
      getComputedStyle: () => ({ display, visibility, opacity })
    },
    querySelectorAll: (selector: string) => selector === 'a[href*="/explore/"]'
      ? anchors
      : [{ getBoundingClientRect: () => rect }]
  });
  const evaluateChallenge = (probeDocument: ReturnType<typeof challengeDocument>) => evaluate({}, probeDocument, {
    origin: "https://www.xiaohongshu.com",
    pathname: "/search_result",
    search: `?keyword=${encodeURIComponent(query)}`
  }).challenge_like;
  assert.equal(evaluateChallenge(challengeDocument({ display: "none" })), false);
  assert.equal(evaluateChallenge(challengeDocument({ visibility: "hidden" })), false);
  assert.equal(evaluateChallenge(challengeDocument({ opacity: "0" })), false);
  assert.equal(evaluateChallenge(challengeDocument({ rect: { width: 0, height: 0, top: 100, left: 100, right: 100, bottom: 100 } })), false);
  assert.equal(evaluateChallenge(challengeDocument({ rect: { width: 640, height: 360, top: 800, left: 100, right: 740, bottom: 1160 } })), false);
  assert.equal(evaluateChallenge(challengeDocument()), true);
  assert.equal(evaluateChallenge(challengeDocument({ display: "none", text: "访问异常，请完成安全验证" })), true);
  const validated = validateReadOperationProbe({
    site_id: "xiaohongshu",
    operation_id: "xhs_search_notes",
    query,
    target_url: `https://www.xiaohongshu.com/search_result?keyword=${encodeURIComponent(query)}`,
    expected_origin: "https://www.xiaohongshu.com"
  }, {
    ...result,
    operation_response_status: 200,
    operation_response_url: "https://so.xiaohongshu.com/api/sns/web/v2/search/notes",
    xhs_response: summarizeXhsSearchResponse(JSON.stringify({
      success: true,
      code: 0,
      data: { items: noteIds.map((id, index) => ({
        id,
        xsec_token: "opaque-navigation-token=",
        note_card: {
          id,
          display_title: publicItems[index]!.title,
          user: { nickname: publicItems[index]!.author_display_name },
          interact_info: { liked_count: 10 + index, comment_count: 2 + index, collected_count: 3 + index }
        }
      })) }
    }))
  });
  assert.equal(validated.status, "completed");
  if (validated.status === "completed") assert.equal(JSON.stringify(validated.public_summary).includes("opaque-navigation-token="), false);

  const renderedOnlyId = "aaaaaaaaaaaaaaaaaaaaaaaa";
  const networkOnlyId = "bbbbbbbbbbbbbbbbbbbbbbbb";
  const detailUrl = (id: string) => `https://www.xiaohongshu.com/explore/${id}?xsec_token=opaque-navigation-token%3D&xsec_source=pc_search`;
  const intersected = validateReadOperationProbe({
    site_id: "xiaohongshu",
    operation_id: "xhs_search_notes",
    query,
    limit: 1,
    target_url: `https://www.xiaohongshu.com/search_result?keyword=${encodeURIComponent(query)}`,
    expected_origin: "https://www.xiaohongshu.com"
  }, {
    ...result,
    note_count: 2,
    detail_urls: [detailUrl(renderedOnlyId), detailUrl(noteIds[1]!)],
    search_items: [{ title: "仅页面可见" }, publicItems[1]!],
    operation_response_status: 200,
    operation_response_url: "https://so.xiaohongshu.com/api/sns/web/v2/search/notes",
    xhs_response: {
      status: "completed",
      detail_urls: [detailUrl(networkOnlyId), detailUrl(noteIds[1]!)],
      search_items: [{ title: "仅网络可见" }, publicItems[1]!]
    }
  });
  assert.equal(intersected.status, "completed");
  if (intersected.status === "completed") {
    assert.equal(intersected.public_summary.result_count, 1);
    assert.deepEqual(intersected.detail_urls, [detailUrl(noteIds[1]!)]);
    assert.deepEqual(intersected.search_items, [publicItems[1]!]);
  }

  for (const candidate of [
    { _s: new Map() },
    { _s: new Map([["other", { searchValue: { value: query }, feeds: { value: [{}] } }]]) },
    { _s: new Map([["search", { searchValue: { value: "wrong query" }, feeds: { value: [{}] } }]]) },
    { _s: new Map([["search", { searchValue: { value: query } }]]) },
    { _s: {} },
    { private: "unrelated" }
  ]) {
    const negative = evaluate({ __PINIA__: candidate }, { ...document, querySelector: () => null }, {
      origin: "https://www.xiaohongshu.com",
      pathname: "/search_result",
      search: `?keyword=${encodeURIComponent(query)}`
    });
    assert.equal(negative.pinia_ready, false);
  }

  const empty = evaluate({ __PINIA__: { _s: new Map([["search", { searchValue: query, feeds: [] }]]) } }, {
    ...document,
    querySelectorAll: () => []
  }, {
    origin: "https://www.xiaohongshu.com", pathname: "/search_result", search: `?keyword=${encodeURIComponent(query)}`
  });
  assert.equal(empty.list_valid, false);
  assert.equal(empty.list_failure, "empty_result");
  const staleRenderedResults = evaluate({ __PINIA__: { _s: new Map([["search", { searchValue: query, feeds: [] }]]) } }, document, {
    origin: "https://www.xiaohongshu.com", pathname: "/search_result", search: `?keyword=${encodeURIComponent(query)}`
  });
  assert.equal(staleRenderedResults.list_failure, "page_not_ready");
  const mismatch = evaluate({ __PINIA__: { _s: new Map([["search", { searchValue: query, feeds: [{ id: "aaaaaaaaaaaaaaaaaaaaaaaa" }] }]]) } }, document, {
    origin: "https://www.xiaohongshu.com", pathname: "/search_result", search: `?keyword=${encodeURIComponent(query)}`
  });
  assert.equal(mismatch.list_valid, false);
  assert.equal(mismatch.list_failure, "page_not_ready");
  const hydrating = evaluate({ __PINIA__: { _s: new Map([["search", {
    searchValue: query,
    feeds: [{ id: noteIds[0], xsec_token: "opaque-navigation-token=", noteCard: { id: noteIds[0] } }]
  }]]) } }, document, {
    origin: "https://www.xiaohongshu.com", pathname: "/search_result", search: `?keyword=${encodeURIComponent(query)}`
  });
  assert.equal(hydrating.list_valid, false);
  assert.equal(hydrating.list_failure, "page_not_ready");

  const incompleteAndValid = evaluate({ __PINIA__: { _s: new Map([["search", {
    searchValue: query,
    feeds: [
      { id: "aaaaaaaaaaaaaaaaaaaaaaaa", xsec_token: "opaque-navigation-token=", noteCard: { id: "aaaaaaaaaaaaaaaaaaaaaaaa" } },
      noteFeed(noteIds[0]!, 0)
    ]
  }]]) } }, {
    ...document,
    querySelectorAll: (selector: string) => selector === 'a[href*="/explore/"]'
      ? [{ getAttribute: () => "/explore/aaaaaaaaaaaaaaaaaaaaaaaa" }, anchors[0]]
      : []
  }, {
    origin: "https://www.xiaohongshu.com", pathname: "/search_result", search: `?keyword=${encodeURIComponent(query)}`
  });
  assert.equal(incompleteAndValid.list_valid, true);
  assert.deepEqual(incompleteAndValid.detail_urls, [`https://www.xiaohongshu.com/explore/${noteIds[0]}?xsec_token=opaque-navigation-token%3D&xsec_source=pc_search`]);
  assert.deepEqual(incompleteAndValid.search_items, [publicItems[0]]);

  const nonstandardAndValid = evaluate({ __PINIA__: { _s: new Map([["search", {
    searchValue: query,
    feeds: [{ noteCard: { id: "not-a-note" } }, noteFeed(noteIds[0]!, 0)]
  }]]) } }, {
    ...document,
    querySelectorAll: (selector: string) => selector === 'a[href*="/explore/"]' ? [anchors[0]] : []
  }, {
    origin: "https://www.xiaohongshu.com", pathname: "/search_result", search: `?keyword=${encodeURIComponent(query)}`
  });
  assert.equal(nonstandardAndValid.list_valid, true);
  assert.deepEqual(nonstandardAndValid.detail_urls, [`https://www.xiaohongshu.com/explore/${noteIds[0]}?xsec_token=opaque-navigation-token%3D&xsec_source=pc_search`]);
  assert.deepEqual(nonstandardAndValid.search_items, [publicItems[0]]);

  const conflictingFeed = evaluate({ __PINIA__: { _s: new Map([["search", {
    searchValue: query,
    feeds: [{
      id: noteIds[0],
      xsec_token: "token-a",
      noteCard: { id: noteIds[1], xsec_token: "token-b", displayTitle: "冲突笔记" }
    }]
  }]]) } }, document, {
    origin: "https://www.xiaohongshu.com", pathname: "/search_result", search: `?keyword=${encodeURIComponent(query)}`
  });
  assert.equal(conflictingFeed.list_failure, "page_not_ready");

  const conflictingToken = evaluate({ __PINIA__: { _s: new Map([["search", {
    searchValue: query,
    feeds: [{
      id: noteIds[0],
      xsec_token: "token-a",
      noteCard: { id: noteIds[0], xsec_token: "token-b", displayTitle: "冲突笔记" }
    }]
  }]]) } }, document, {
    origin: "https://www.xiaohongshu.com", pathname: "/search_result", search: `?keyword=${encodeURIComponent(query)}`
  });
  assert.equal(conflictingToken.list_failure, "page_not_ready");

  const conflictingTokensAcrossFeeds = evaluate({ __PINIA__: { _s: new Map([["search", {
    searchValue: query,
    feeds: [
      { ...noteFeed(noteIds[0]!, 0), xsec_token: "token-a" },
      { ...noteFeed(noteIds[0]!, 0), xsec_token: "token-b" }
    ]
  }]]) } }, document, {
    origin: "https://www.xiaohongshu.com", pathname: "/search_result", search: `?keyword=${encodeURIComponent(query)}`
  });
  assert.equal(conflictingTokensAcrossFeeds.list_failure, "page_not_ready");

  const mixedFeeds = [{ kind: "promoted-banner" }, noteFeed(noteIds[1]!, 1), { recommendation: true }, noteFeed(noteIds[0]!, 0)];
  const virtualSubset = evaluate({ __PINIA__: { _s: new Map([["search", { searchValue: query, feeds: mixedFeeds }]]) } }, {
    ...document,
    querySelector: () => null,
    querySelectorAll: () => [anchors[0]]
  }, { origin: "https://www.xiaohongshu.com", pathname: "/search_result", search: `?keyword=${encodeURIComponent(query)}` });
  assert.equal(virtualSubset.list_valid, true);
  assert.deepEqual(virtualSubset.detail_urls, [`https://www.xiaohongshu.com/explore/${noteIds[0]}?xsec_token=opaque-navigation-token%3D&xsec_source=pc_search`]);
  assert.deepEqual(virtualSubset.search_items, [publicItems[0]]);

  const reordered = evaluate({ __PINIA__: { _s: new Map([["search", { searchValue: query, feeds: mixedFeeds }]]) } }, {
    ...document,
    querySelector: () => null,
    querySelectorAll: () => [...anchors].reverse()
  }, { origin: "https://www.xiaohongshu.com", pathname: "/search_result", search: `?keyword=${encodeURIComponent(query)}` });
  assert.equal(reordered.list_valid, true);
  assert.deepEqual(reordered.detail_urls, noteIds.slice().reverse().map((id) => `https://www.xiaohongshu.com/explore/${id}?xsec_token=opaque-navigation-token%3D&xsec_source=pc_search`));
  assert.deepEqual(reordered.search_items, [...publicItems].reverse());

  const duplicateFeed = evaluate({ __PINIA__: { _s: new Map([["search", { searchValue: query, feeds: [noteFeed(noteIds[0]!, 0), noteFeed(noteIds[0]!, 0)] }]]) } }, {
    ...document,
    querySelector: () => null,
    querySelectorAll: () => [anchors[0]]
  }, { origin: "https://www.xiaohongshu.com", pathname: "/search_result", search: `?keyword=${encodeURIComponent(query)}` });
  assert.equal(duplicateFeed.list_valid, true);
  assert.deepEqual(duplicateFeed.detail_urls, [`https://www.xiaohongshu.com/explore/${noteIds[0]}?xsec_token=opaque-navigation-token%3D&xsec_source=pc_search`]);

  const unsupportedFeed = evaluate({ __PINIA__: { _s: new Map([["search", { searchValue: query, feeds: [{ kind: "promoted-banner" }, { noteCard: { id: "not-a-note" } }] }]]) } }, {
    ...document,
    querySelector: () => null,
    querySelectorAll: () => [anchors[0]]
  }, { origin: "https://www.xiaohongshu.com", pathname: "/search_result", search: `?keyword=${encodeURIComponent(query)}` });
  assert.equal(unsupportedFeed.list_failure, "page_not_ready");
  const malformedFeedWithoutTarget = evaluate({ __PINIA__: { _s: new Map([["search", { searchValue: query, feeds: [{ noteCard: { id: "not-a-note" } }] }]]) } }, {
    ...document,
    querySelector: () => null,
    querySelectorAll: () => []
  }, { origin: "https://www.xiaohongshu.com", pathname: "/search_result", search: `?keyword=${encodeURIComponent(query)}` });
  assert.equal(malformedFeedWithoutTarget.list_failure, "page_not_ready");

  const duplicateAnchor = evaluate({ __PINIA__: { _s: new Map([["search", { searchValue: query, feeds: [noteFeed(noteIds[0]!, 0)] }]]) } }, {
    ...document,
    querySelector: () => null,
    querySelectorAll: () => [anchors[0], anchors[0]]
  }, { origin: "https://www.xiaohongshu.com", pathname: "/search_result", search: `?keyword=${encodeURIComponent(query)}` });
  assert.equal(duplicateAnchor.list_valid, true);

  const invalidAnchor = evaluate({ __PINIA__: { _s: new Map([["search", { searchValue: query, feeds: [noteFeed(noteIds[0]!, 0)] }]]) } }, {
    ...document,
    querySelector: () => null,
    querySelectorAll: () => [{ getAttribute: () => `https://evil.example/explore/${noteIds[0]}` }]
  }, { origin: "https://www.xiaohongshu.com", pathname: "/search_result", search: `?keyword=${encodeURIComponent(query)}` });
  assert.equal(invalidAnchor.list_failure, "page_not_ready");

  const unrelatedInvalidAnchor = evaluate({ __PINIA__: { _s: new Map([["search", { searchValue: query, feeds: [noteFeed(noteIds[0]!, 0)] }]]) } }, {
    ...document,
    querySelector: () => null,
    querySelectorAll: () => [anchors[0], { getAttribute: () => `https://evil.example/explore/${noteIds[1]}` }]
  }, { origin: "https://www.xiaohongshu.com", pathname: "/search_result", search: `?keyword=${encodeURIComponent(query)}` });
  assert.equal(unrelatedInvalidAnchor.list_valid, true);
});

test("observes BOSS SPA, login wall, and challenge state without returning page text", () => {
  const evaluate = new Function("document", "location", `return ${readProbeExpression("boss", "AI", "101010100")}`);
  const location = { origin: "https://www.zhipin.com", pathname: "/web/geek/job", search: "?query=AI&city=101010100" };
  const document = bossSpaDocument();
  assert.deepEqual(evaluate(document, location), {
    origin: location.origin,
    pathname: location.pathname,
    search: location.search,
    ready: true,
    rendered_surface: true,
    vue_owned: true,
    job_card_count: 1,
    job_cards_valid: true,
    login_like: false,
    challenge_like: false
  });
  assert.equal(evaluate(bossSpaDocument({ text: `${"公开职位 ".repeat(400)}访问异常，请完成安全验证` }), location).challenge_like, true);
  assert.equal(evaluate(bossSpaDocument({ text: "Join us to solve meaningful hiring challenges" }), location).challenge_like, false);
  assert.equal(evaluate(bossSpaDocument({ text: "Verification challenge required" }), location).challenge_like, true);
  assert.equal(evaluate(bossSpaDocument({ loginOverlay: true }), location).login_like, true);
  assert.equal(evaluate(bossSpaDocument({ challengeOverlay: true }), location).challenge_like, true);
  assert.equal(evaluate(bossSpaDocument({ verifyElement: true }), location).challenge_like, false);
  assert.equal(evaluate(bossSpaDocument({ challengeOverlay: true, challengeOverlayHidden: true }), location).challenge_like, false);
  assert.equal(evaluate(bossSpaDocument({ vueOwned: false }), location).rendered_surface, false);
  assert.equal(evaluate(bossSpaDocument({ fakeVueState: true }), location).rendered_surface, false);
  assert.equal(evaluate(bossSpaDocument({ mountedSubtreeOwned: false }), location).rendered_surface, false);
  assert.equal(evaluate(bossSpaDocument({ rootOwnsList: false }), location).rendered_surface, false);
  assert.equal(evaluate(bossSpaDocument({ cards: [] }), location).rendered_surface, false);
  assert.equal(evaluate(bossSpaDocument({ validCard: false }), location).rendered_surface, false);
  assert.equal(JSON.stringify(evaluate(bossSpaDocument({ text: "private-marker" }), location)).includes("private-marker"), false);
});

test("observes XHS detail Vue and note Pinia readiness without returning store contents", () => {
  const evaluate = new Function("window", "document", "location", `return ${readProbeExpression("xiaohongshu", "", undefined, "xhs_read_note_detail")}`);
  const piniaNote = {
    noteId: "0123456789abcdef01234567",
    title: "公开标题",
    desc: "这是用于验证正文相关性的公开正文摘要",
    user: { nickname: "公开作者", userId: "author_123" },
    interactInfo: { liked_count: 10, comment_count: 2, collected_count: 3, share_count: 0 },
    private: "must-not-return"
  };
  const pinia = { _s: new Map([["note", { $state: { noteDetailMap: { [piniaNote.noteId]: { note: piniaNote } } } }]]) };
  const app = { __vue_app__: { config: { globalProperties: { $pinia: pinia } } } };
  const engagementRoot = {
    querySelector: (selector: string) => {
      if (selector.includes("like")) return { textContent: "10" };
      if (selector.includes("comment")) return { textContent: "2" };
      if (selector.includes("collect")) return { textContent: "3" };
      if (selector.includes("share")) return { textContent: "0" };
      return null;
    }
  };
  const detailRoot = {
    querySelector: (selector: string) => {
      if (selector === ".interactions.engage-bar") return engagementRoot;
      if (selector.includes("user/profile")) return { getAttribute: () => "/user/profile/author_123" };
      if (selector.includes("author")) return { textContent: "公开作者" };
      if (selector.includes("like") || selector.includes("comment") || selector.includes("collect") || selector.includes("share")) return { textContent: "999" };
      if (selector.includes("note-title") || selector.includes(".title")) return { textContent: "公开标题" };
      if (selector.includes("detail-desc") || selector.includes("note-desc")) return { textContent: piniaNote.desc };
      return null;
    }
  };
  const narrowDetailRoot = { querySelector: () => null };
  const document = {
    readyState: "complete",
    body: { innerText: "公开笔记详情" },
    querySelector: (selector: string) => {
      if (selector === "#app") return app;
      if (selector === "#noteContainer") return detailRoot;
      if (selector === '.note-detail-mask, [class*="note-detail"], #noteContainer') return narrowDetailRoot;
      if (selector === '.note-detail-mask, [class*="note-detail"]') return narrowDetailRoot;
      if (selector.includes("captcha") || selector.includes("login")) return null;
      if (selector.includes("user/profile")) return { getAttribute: () => "/user/profile/logged_in_user" };
      if (selector.includes("like") || selector.includes("comment") || selector.includes("collect") || selector.includes("share")) return { textContent: "999" };
      if (selector.includes("note-title") || selector.includes(".title")) return { textContent: "推荐标题" };
      if (selector.includes("detail-desc") || selector.includes("note-desc") || selector.includes("note-content")) return { textContent: "推荐正文" };
      if (selector.includes("author")) return { textContent: "登录用户" };
      if (selector.includes("interaction-container")) return {};
      return null;
    }
  };
  const location = { origin: "https://www.xiaohongshu.com", pathname: "/explore/0123456789abcdef01234567", search: "?xsec_token=private" };
  assert.equal((detailRoot.querySelector('[class*="like"] [class*="count"]') as { textContent?: string } | null)?.textContent, "999");
  const observed = evaluate({}, document, location);
  assert.equal(observed.vue_ready, true);
  assert.equal(observed.pinia_ready, true);
  assert.equal(observed.normalized.canonical_url, `${location.origin}${location.pathname}`);
  assert.equal(observed.normalized.note_id, "0123456789abcdef01234567");
  assert.equal(observed.normalized.author.author_id, "author_123");
  assert.deepEqual(observed.normalized.interaction_metrics, { likes: "10", comments: "2", collects: "3", shares: "0" });
  assert.equal(JSON.stringify(observed).includes("must-not-return"), false);
  assert.equal(JSON.stringify(observed).includes("xsec_token"), false);
  const directDetail = evaluate({}, {
    ...document,
    querySelector: (selector: string) => {
      if (selector === "#noteContainer") return detailRoot;
      if (selector === '.note-detail-mask, [class*="note-detail"]') return null;
      return document.querySelector(selector);
    }
  }, location);
  assert.equal(directDetail.normalized.author.author_id, "author_123");
  const observeBodyPair = (renderedBody: string, storedBody: string) => evaluate({
    __PINIA__: {
      _s: new Map([["note", { $state: { noteDetailMap: { [piniaNote.noteId]: { note: { ...piniaNote, desc: storedBody } } } } }]])
    }
  }, {
    ...document,
    querySelector: (selector: string) => selector === "#noteContainer"
      ? {
          querySelector: (detailSelector: string) => detailSelector.includes("detail-desc") || detailSelector.includes("note-desc")
            ? { textContent: renderedBody }
            : detailRoot.querySelector(detailSelector)
        }
      : document.querySelector(selector)
  }, location);
  const decoratedBody = observeBodyPair(`${piniaNote.desc} #美食 #家常菜`, piniaNote.desc);
  assert.equal(decoratedBody.normalized.body_summary, `${piniaNote.desc} #美食 #家常菜`);
  const topicMarkedBody = observeBodyPair(`${piniaNote.desc} #美食 #家常菜`, `${piniaNote.desc} #美食[话题]# #家常菜[话题]#`);
  assert.equal(topicMarkedBody.normalized.body_summary, `${piniaNote.desc} #美食 #家常菜`);
  assert.equal(observeBodyPair("1234abcdefgh", "12😀34🥘abcdefgh").normalized.body_summary, "1234abcdefgh");
  assert.equal(observeBodyPair("1234abcdefgh", "12\uFE0E34\u{E0100}abcdefgh").normalized.body_summary, "1234abcdefgh");
  assert.equal(observeBodyPair("1234567 #公开笔记装饰内容", "1234567").normalized, undefined);
  assert.equal(observeBodyPair("12345678abcdefghijklmnop", "12345678").normalized, undefined);
  assert.equal(observeBodyPair("12345678", "1234567890123456").normalized, undefined);
  assert.equal(observeBodyPair("12345678", "12348765").normalized, undefined);
  assert.equal(observeBodyPair("abcdefgh", "a1b2c3d4e5f6g7h").normalized, undefined);
  assert.equal(observeBodyPair(piniaNote.desc, "这是另一条完全无关且长度足够的公开正文").normalized, undefined);
  const titlelessBody = "这是一条没有单独标题的公开笔记正文";
  const titleless = evaluate({
    __PINIA__: {
      _s: new Map([["note", { $state: { noteDetailMap: { [piniaNote.noteId]: { note: { ...piniaNote, title: "", desc: titlelessBody } } } } }]])
    }
  }, {
    ...document,
    querySelector: (selector: string) => selector === "#noteContainer"
      ? {
          querySelector: (detailSelector: string) => detailSelector.includes("detail-desc") || detailSelector.includes("note-desc")
            ? { textContent: titlelessBody }
            : detailSelector.includes("note-title") || detailSelector.includes(".title")
              ? { textContent: "" }
              : detailRoot.querySelector(detailSelector)
        }
      : document.querySelector(selector)
  }, location);
  assert.equal(titleless.normalized.title, titlelessBody);
  const longBody = "正".repeat(2_100);
  const boundedLongBody = observeBodyPair(longBody, longBody).normalized;
  assert.equal(boundedLongBody.summary.length, 500);
  assert.equal(boundedLongBody.body_summary.length, 2_000);
  const titleBoundaryBody = `${"正".repeat(199)}😀正文`;
  const titleBoundary = evaluate({
    __PINIA__: {
      _s: new Map([["note", { $state: { noteDetailMap: { [piniaNote.noteId]: { note: { ...piniaNote, title: "", desc: titleBoundaryBody } } } } }]])
    }
  }, {
    ...document,
    querySelector: (selector: string) => selector === "#noteContainer"
      ? {
          querySelector: (detailSelector: string) => detailSelector.includes("detail-desc") || detailSelector.includes("note-desc")
            ? { textContent: titleBoundaryBody }
            : detailSelector.includes("note-title") || detailSelector.includes(".title")
              ? { textContent: "" }
              : detailRoot.querySelector(detailSelector)
        }
      : document.querySelector(selector)
  }, location);
  assert.equal(titleBoundary.normalized.title, "正".repeat(199));
  assert.equal(/[\uD800-\uDBFF]$/.test(titleBoundary.normalized.title), false);
  const missingDetailAuthor = evaluate({}, {
    ...document,
    querySelector: (selector: string) => selector === "#noteContainer"
      ? { querySelector: () => null }
      : selector === '.note-detail-mask, [class*="note-detail"]'
        ? null
      : document.querySelector(selector)
  }, location);
  assert.equal(missingDetailAuthor.normalized, undefined);

  const missingVisibleShare = evaluate({}, {
    ...document,
    querySelector: (selector: string) => selector === "#noteContainer"
      ? {
          querySelector: (detailSelector: string) => detailSelector === ".interactions.engage-bar"
            ? { querySelector: (metricSelector: string) => metricSelector.includes("share") ? null : engagementRoot.querySelector(metricSelector) }
            : detailRoot.querySelector(detailSelector)
        }
      : document.querySelector(selector)
  }, location);
  assert.equal(missingVisibleShare.normalized.source_status, "partially_located");
  assert.deepEqual(missingVisibleShare.normalized.interaction_metrics, { likes: "10", comments: "2", collects: "3", shares: "0" });
  assert.equal(validateReadOperationProbe({
    site_id: "xiaohongshu",
    operation_id: "xhs_read_note_detail",
    detail_ref: opaqueRef("detail_ref"),
    target_url: `${location.origin}${location.pathname}`,
    expected_origin: location.origin
  }, {
    ...missingVisibleShare,
    operation_response_status: 200,
    operation_response_url: `${location.origin}${location.pathname}`
  }).status, "completed");

  const missingShareStore = {
    _s: new Map([["note", { $state: { noteDetailMap: { [piniaNote.noteId]: { note: {
      ...piniaNote,
      interactInfo: { likedCount: 10, commentCount: 2, collectedCount: 3 }
    } } } } }]])
  };
  const missingShareEverywhere = evaluate({ __PINIA__: missingShareStore }, {
    ...document,
    querySelector: (selector: string) => selector === "#noteContainer"
      ? {
          querySelector: (detailSelector: string) => detailSelector === ".interactions.engage-bar"
            ? { querySelector: (metricSelector: string) => metricSelector.includes("share") ? null : engagementRoot.querySelector(metricSelector) }
            : detailRoot.querySelector(detailSelector)
        }
      : document.querySelector(selector)
  }, location);
  assert.equal(missingShareEverywhere.normalized.source_status, "partially_located");
  assert.deepEqual(missingShareEverywhere.normalized.interaction_metrics, { likes: "10", comments: "2", collects: "3", shares: "未显示" });
  const missingShareValidation = validateReadOperationProbe({
    site_id: "xiaohongshu",
    operation_id: "xhs_read_note_detail",
    detail_ref: opaqueRef("detail_ref"),
    target_url: `${location.origin}${location.pathname}`,
    expected_origin: location.origin
  }, {
    ...missingShareEverywhere,
    operation_response_status: 200,
    operation_response_url: `${location.origin}${location.pathname}`
  });
  assert.equal(missingShareValidation.status, "completed");

  const withoutNoteStore = evaluate({ __PINIA__: { _s: new Map([["search", {}]]) } }, { ...document, querySelector: (selector: string) => selector === "#app" ? { __vue_app__: { config: { globalProperties: {} } } } : document.querySelector(selector) }, location);
  assert.equal(withoutNoteStore.vue_ready, true);
  assert.equal(withoutNoteStore.pinia_ready, false);
  assert.equal(withoutNoteStore.normalized, undefined);

  const mismatchedStore = { _s: new Map([["note", { $state: { noteDetailMap: { [piniaNote.noteId]: { note: { ...piniaNote, noteId: "fedcba987654321001234567" } } } } }]]) };
  const mismatchedApp = { __vue_app__: { config: { globalProperties: { $pinia: mismatchedStore } } } };
  const mismatched = evaluate({}, { ...document, querySelector: (selector: string) => selector === "#app" ? mismatchedApp : document.querySelector(selector) }, location);
  assert.equal(mismatched.pinia_ready, true);
  assert.equal(mismatched.normalized, undefined);

  const dummyStore = { _s: new Map([["note", { $state: { noteDetailMap: { [piniaNote.noteId]: { note: { ...piniaNote, title: "注入标题" } } } } }]]) };
  const dummyApp = { __vue_app__: { config: { globalProperties: { $pinia: dummyStore } } } };
  const dummy = evaluate({}, { ...document, querySelector: (selector: string) => selector === "#app" ? dummyApp : document.querySelector(selector) }, location);
  assert.equal(dummy.pinia_ready, true);
  assert.equal(dummy.normalized, undefined);

  const numericTitleStore = { _s: new Map([["note", { $state: { noteDetailMap: { [piniaNote.noteId]: { note: { ...piniaNote, title: 123 } } } } }]]) };
  assert.equal(evaluate({ __PINIA__: numericTitleStore }, document, location).normalized, undefined);
  for (const invalidMetric of [{}, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    const invalidMetricStore = { _s: new Map([["note", { $state: { noteDetailMap: { [piniaNote.noteId]: { note: { ...piniaNote, interactInfo: { ...piniaNote.interactInfo, likedCount: invalidMetric } } } } } }]]) };
    assert.equal(evaluate({ __PINIA__: invalidMetricStore }, document, location).normalized, undefined);
  }

  const withoutPinia = evaluate({}, { ...document, querySelector: (selector: string) => selector === "#app" ? { __vue_app__: { config: { globalProperties: {} } } } : document.querySelector(selector) }, location);
  assert.equal(withoutPinia.pinia_ready, false);
  assert.equal(withoutPinia.normalized, undefined);
});

test("detects late challenge and login overlays for both detail sites", () => {
  const lateChallenge = `${"公开内容".repeat(1000)}访问异常，请完成安全验证`;
  const lateLogin = `${"公开内容".repeat(1000)}扫码登录`;
  const xhsEvaluate = new Function("window", "document", "location", `return ${readProbeExpression("xiaohongshu", "", undefined, "xhs_read_note_detail")}`);
  const bossEvaluate = new Function("document", "location", `return ${readProbeExpression("boss", "", undefined, "boss_read_job_detail")}`);
  const document = { readyState: "complete", body: { innerText: lateChallenge }, querySelector: () => null, querySelectorAll: () => [] };
  assert.equal(xhsEvaluate({}, document, { origin: "https://www.xiaohongshu.com", pathname: "/explore/0123456789abcdef01234567" }).challenge_like, true);
  assert.equal(bossEvaluate(document, { origin: "https://www.zhipin.com", pathname: "/job_detail/AbC_123.html" }).challenge_like, true);
  assert.equal(xhsEvaluate({}, { ...document, body: { innerText: lateLogin } }, { origin: "https://www.xiaohongshu.com", pathname: "/explore/0123456789abcdef01234567" }).login_like, true);
  assert.equal(bossEvaluate({ ...document, body: { innerText: lateLogin } }, { origin: "https://www.zhipin.com", pathname: "/job_detail/AbC_123.html" }).login_like, true);
  const visibleOverlay = { getBoundingClientRect: () => ({ width: 100, height: 100, top: 0, left: 0, right: 100, bottom: 100 }) };
  const visibleView = { innerWidth: 1280, innerHeight: 800, getComputedStyle: () => ({ display: "block", visibility: "visible", opacity: "1" }) };
  const overlayDocument = { ...document, defaultView: visibleView, body: { innerText: "公开详情" }, querySelectorAll: () => [visibleOverlay] };
  assert.equal(xhsEvaluate({}, overlayDocument, { origin: "https://www.xiaohongshu.com", pathname: "/explore/0123456789abcdef01234567" }).challenge_like, true);
  assert.equal(bossEvaluate(overlayDocument, { origin: "https://www.zhipin.com", pathname: "/job_detail/AbC_123.html" }).challenge_like, true);
  const securityOverlayDocument = { ...document, defaultView: visibleView, body: { innerText: "公开详情" }, querySelectorAll: () => [visibleOverlay] };
  assert.equal(bossEvaluate(securityOverlayDocument, { origin: "https://www.zhipin.com", pathname: "/job_detail/AbC_123.html" }).challenge_like, true);
  const qrLoginDocument = { ...document, body: { innerText: "公开详情" }, querySelector: (selector: string) => selector.includes("qrcode") ? {} : null };
  assert.equal(bossEvaluate(qrLoginDocument, { origin: "https://www.zhipin.com", pathname: "/job_detail/AbC_123.html" }).login_like, true);
  const verifyOnlyDocument = { ...document, body: { innerText: "We solve meaningful hiring challenges" }, querySelector: (selector: string) => selector.includes("verify") ? {} : null };
  assert.equal(bossEvaluate(verifyOnlyDocument, { origin: "https://www.zhipin.com", pathname: "/job_detail/AbC_123.html" }).challenge_like, false);
  const hiddenOverlayDocument = {
    ...document,
    defaultView: { ...visibleView, getComputedStyle: () => ({ display: "none", visibility: "hidden", opacity: "0" }) },
    body: { innerText: "公开详情" },
    querySelectorAll: () => [visibleOverlay]
  };
  assert.equal(bossEvaluate(hiddenOverlayDocument, { origin: "https://www.zhipin.com", pathname: "/job_detail/AbC_123.html" }).challenge_like, false);
  const explicitChallengeDocument = { ...document, body: { innerText: "Verification challenge required" } };
  assert.equal(bossEvaluate(explicitChallengeDocument, { origin: "https://www.zhipin.com", pathname: "/job_detail/AbC_123.html" }).challenge_like, true);
});

test("bounds the entire BOSS site-resource probe when the CDP page list never responds", async () => {
  const server = createServer(() => undefined);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not expose a TCP port.");
  const startedAt = Date.now();
  try {
    const result = await probeProviderSiteResource(String(address.port), "https://www.zhipin.com/web/geek/job", {
      site_id: "boss",
      task_kind: "job_search"
    }, 50);
    assert.equal(result.status, "unknown");
    assert.equal("failure_class" in result ? result.failure_class : null, "provider_probe_unavailable");
    assert(Date.now() - startedAt < 500, "site-resource deadline should abort a never-responding /json/list request");
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

function bossSpaDocument(options: {
  text?: string;
  vueOwned?: boolean;
  fakeVueState?: boolean;
  mountedSubtreeOwned?: boolean;
  rootOwnsList?: boolean;
  cards?: unknown[];
  validCard?: boolean;
  loginOverlay?: boolean;
  challengeOverlay?: boolean;
  challengeOverlayHidden?: boolean;
  verifyElement?: boolean;
} = {}) {
  const card = {
    querySelector(selector: string) {
      if (selector.includes("job-name")) return { textContent: options.validCard === false ? "" : "AI 产品经理" };
      if (selector.includes("company-name")) return { textContent: "示例科技" };
      if (selector.startsWith("a[")) return options.validCard === false ? null : { getAttribute: () => "/job_detail/example.html" };
      return null;
    }
  };
  const cards = (options.cards ?? [card]) as typeof card[];
  const list = {
    querySelectorAll: () => cards,
    contains: (candidate: unknown) => cards.includes(candidate as typeof card)
  };
  const mountedElement = {};
  const root: Record<string, any> = {
    querySelector: () => list,
    contains: (candidate: unknown) => (options.rootOwnsList !== false && candidate === list) || (options.mountedSubtreeOwned !== false && candidate === mountedElement)
  };
  if (options.vueOwned !== false) {
    const app: Record<string, any> = { version: "3", config: { globalProperties: {} }, _container: root };
    root.__vue_app__ = app;
    if (options.fakeVueState) {
      root.__vueParentComponent = { appContext: { app }, subTree: { el: mountedElement } };
    } else {
      const component = { appContext: { app }, vnode: { el: mountedElement }, subTree: { el: mountedElement } };
      app._instance = component;
      root._vnode = { component };
    }
  }
  return {
    defaultView: {
      innerWidth: 1280,
      innerHeight: 720,
      getComputedStyle: () => ({
        display: options.challengeOverlayHidden ? "none" : "block",
        visibility: "visible",
        opacity: "1"
      })
    },
    readyState: "complete",
    body: { innerText: options.text ?? "公开职位列表" },
    querySelectorAll(selector: string) {
      const elements: object[] = [];
      if (options.challengeOverlay && ["captcha", "challenge", "security-check"].some((token) => selector.includes(`[class*="${token}"]`) || selector.includes(`[id*="${token}"]`))) {
        elements.push({ getBoundingClientRect: () => ({ width: 640, height: 360, top: 100, left: 100, right: 740, bottom: 460 }) });
      }
      if (options.verifyElement && (selector.includes('[class*="verify"]') || selector.includes('[id*="verify"]'))) {
        elements.push({ getBoundingClientRect: () => ({ width: 200, height: 40, top: 100, left: 100, right: 300, bottom: 140 }) });
      }
      return elements;
    },
    querySelector(selector: string) {
      if (selector.includes("login-dialog")) return options.loginOverlay ? {} : null;
      if (selector === "#wrap, #app") return root;
      return null;
    }
  };
}

test("does not construct post-check provenance from missing or arbitrary source labels", () => {
  const admitted = admitAllowlistedReadOperation({ site_id: "boss", operation_id: "boss_job_search", query: "AI tools", city_code: "101010100" });
  if (typeof admitted === "string") throw new Error("Pinned BOSS operation was unexpectedly rejected.");
  const store = new ReadOperationObservationStore();
  const observedSource = { kind: "network_summary", ref: opaqueRef("source") };
  const observedEvidence = [
    { kind: "snapshot_ref", ref: opaqueRef("evidence") },
    { kind: "network_summary_ref", ref: opaqueRef("evidence") }
  ];
  assert.equal(store.capture({
    operation_ref: "read_operation_test",
    runtime_session_ref: "session_test",
    entry: admitted.entry,
    observed_origin: "https://www.zhipin.com",
    observed_at: "2026-07-11T00:00:00.000Z",
    source_refs: [{ kind: "attacker_label", ref: opaqueRef("source") }],
    evidence_ref_kinds: [{ kind: "snapshot_ref", ref: opaqueRef("evidence") }],
    public_summary_source_ref: opaqueRef("source"),
    public_summary: {
      schema_version: "harbor-read-operation-public-summary/v0",
      operation_id: "boss_job_search",
      result_kind: "boss_job_search_surface",
      surface: "web_geek_jobs",
      result_state: "operation_read_response_observed",
      response_status: 200,
      query: "AI tools",
      city_code: "101010100",
      business_code: 0,
      job_count: 2,
      source_signals: ["boss_wapi_zpgeek_read_network"]
    }
  }), "source_refs_missing");

  const proof = store.capture({
    operation_ref: "read_operation_bound",
    runtime_session_ref: "session_bound",
    entry: admitted.entry,
    observed_origin: "https://www.zhipin.com",
    observed_at: "2026-07-11T00:00:01.000Z",
    source_refs: [observedSource],
    evidence_ref_kinds: observedEvidence,
    public_summary_source_ref: observedSource.ref,
    public_summary: {
      schema_version: "harbor-read-operation-public-summary/v0",
      operation_id: "boss_job_search",
      result_kind: "boss_job_search_surface",
      surface: "web_geek_jobs",
      result_state: "operation_read_response_observed",
      response_status: 200,
      query: "AI tools",
      city_code: "101010100",
      business_code: 0,
      job_count: 2,
      source_signals: ["boss_wapi_zpgeek_read_network"]
    }
  });
  if (typeof proof === "string") throw new Error("Bound observation was unexpectedly rejected.");
  const source = proof.source_refs[0]!;
  const networkEvidence = proof.evidence_ref_kinds.find((ref) => ref.kind === "network_summary_ref")!;
  assert.notEqual(source.ref, proof.post_check_ref);
  assert.notEqual(networkEvidence.ref, proof.post_check_ref);
  assert.notEqual(proof.public_summary_ref, proof.post_check_ref);
  assert.notEqual(proof.public_summary_ref, source.ref);
  assert.equal(store.get(proof.public_summary_ref)?.summary_source_ref, source.ref);
  assert.equal(store.get(networkEvidence.ref)?.summary_source_ref, source.ref);
  const postCheck = store.get(proof.post_check_ref);
  assert.deepEqual(postCheck?.post_check?.source_refs, proof.source_refs);
  assert.deepEqual(postCheck?.post_check?.evidence_refs, proof.evidence_refs);
  const forged = { ...proof, source_refs: [{ kind: "attacker_label", ref: source.ref }] };
  assert.equal(store.complete(admitted.entry, forged), "post_check_missing");
  assert.equal(store.complete(admitted.entry, { ...proof, public_summary_source_ref: opaqueRef("source") }), "public_summary_missing");
  assert.equal(store.complete(admitted.entry, { ...proof, public_summary: { ...proof.public_summary, response_status: 201 } }), "public_summary_missing");
  assert.equal(store.complete(admitted.entry, { ...proof, public_summary: { ...proof.public_summary, result_count: 1 } }), "public_summary_missing");
});

test("rejects tampering with persisted XHS search cards", () => {
  const admitted = admitAllowlistedReadOperation({ site_id: "xiaohongshu", operation_id: "xhs_search_notes", query: "AI", limit: 1 });
  if (typeof admitted === "string") throw new Error("XHS search admission unexpectedly failed.");
  const store = new ReadOperationObservationStore();
  const sources = ["pinia_store_summary", "network_summary", "dom_snapshot_summary"].map((kind) => ({ kind, ref: opaqueRef("source") }));
  const detailRef = opaqueRef("detail_ref");
  const publicSummary = {
    schema_version: "harbor-read-operation-public-summary/v1" as const,
    operation_id: "xhs_search_notes" as const,
    result_kind: "xiaohongshu_search_notes_surface" as const,
    surface: "search_result" as const,
    result_state: "operation_read_response_observed" as const,
    response_status: 200,
    result_count: 1,
    detail_refs: [detailRef],
    items: [{ detail_ref: detailRef, title: "公开标题", author_display_name: "公开作者", interaction_metrics: { likes: "10" } }],
    source_signals: ["pinia_store", "xhs_search_read_network"]
  };
  const proof = store.capture({
    operation_ref: opaqueRef("read_operation"),
    runtime_session_ref: "session_xhs_search",
    entry: admitted.entry,
    observed_origin: "https://www.xiaohongshu.com",
    observed_at: "2026-07-28T00:00:00.000Z",
    source_refs: sources,
    evidence_ref_kinds: [{ kind: "snapshot_ref", ref: opaqueRef("evidence") }],
    public_summary_source_ref: sources[1]!.ref,
    public_summary: publicSummary
  });
  if (typeof proof === "string") throw new Error(`XHS search proof failed: ${proof}`);
  assert.notEqual(typeof store.complete(admitted.entry, proof), "string");
  assert.equal(store.complete(admitted.entry, {
    ...proof,
    public_summary: {
      ...proof.public_summary,
      items: [{ ...proof.public_summary.items![0]!, title: "篡改标题" }]
    }
  }), "public_summary_missing");
});

test("completes XHS detail only with bounded public fields and all Lode source refs", () => {
  const admitted = admitAllowlistedReadOperation({ site_id: "xiaohongshu", operation_id: "xhs_read_note_detail", detail_ref: opaqueRef("detail_ref") });
  if (typeof admitted === "string") throw new Error("XHS detail admission unexpectedly failed.");
  const store = new ReadOperationObservationStore();
  const sources = ["pinia_store_summary", "network_summary", "dom_snapshot_summary"].map((kind) => ({ kind, ref: opaqueRef("source") }));
  const publicSummary = {
    schema_version: "harbor-read-operation-public-summary/v0" as const,
    operation_id: "xhs_read_note_detail" as const,
    result_kind: "xiaohongshu_note_detail_surface" as const,
    surface: "note_detail" as const,
    result_state: "operation_read_response_observed" as const,
    response_status: 200,
    normalized: {
      kind: "xiaohongshu_note_detail" as const,
      canonical_url: "https://www.xiaohongshu.com/explore/0123456789abcdef01234567",
      note_id: "0123456789abcdef01234567",
      title: "公开标题",
      summary: "公开摘要",
      body_summary: "公开正文摘要",
      author: { display_name: "公开作者", author_id: "author_123", profile_url: "https://www.xiaohongshu.com/user/profile/author_123" },
      interaction_metrics: { likes: "10", comments: "2", collects: "3", shares: "1" },
      source_citation: {
        kind: "xhs_note_detail_ref" as const,
        note_id: "0123456789abcdef01234567",
        url: "https://www.xiaohongshu.com/explore/0123456789abcdef01234567",
        field_sources: ["pinia_store_summary", "network_summary", "dom_snapshot_summary"]
      },
      source_status: "located" as const
    },
    source_signals: ["pinia_note_store_ready", "xhs_note_detail_document", "xhs_note_detail_rendered"]
  };
  const proof = store.capture({
    operation_ref: opaqueRef("read_operation"),
    runtime_session_ref: "session_xhs_detail",
    entry: admitted.entry,
    observed_origin: "https://www.xiaohongshu.com",
    observed_at: "2026-07-12T00:00:00.000Z",
    source_refs: sources,
    evidence_ref_kinds: [{ kind: "snapshot_ref", ref: opaqueRef("evidence") }],
    public_summary_source_ref: sources[0]!.ref,
    public_summary: publicSummary
  });
  if (typeof proof === "string") throw new Error(`XHS detail proof failed: ${proof}`);
  const completed = store.complete(admitted.entry, proof);
  if (typeof completed === "string") throw new Error(`XHS detail completion failed: ${completed}`);
  assert.equal("merge_commit" in completed.lode_pin && completed.lode_pin.merge_commit, LODE_268_DETAIL_PIN.merge_commit);
  assert.equal(completed.public_summary.normalized?.kind, "xiaohongshu_note_detail");
  assert.equal(completed.public_summary.normalized?.kind === "xiaohongshu_note_detail" && completed.public_summary.normalized.note_id, "0123456789abcdef01234567");
  assert.equal(completed.public_summary.normalized?.kind === "xiaohongshu_note_detail" && completed.public_summary.normalized.source_citation.kind, "xhs_note_detail_ref");
  assert.deepEqual(completed.source_refs.map((entry) => entry.kind), ["pinia_store_summary", "network_summary", "dom_snapshot_summary"]);
  assert.deepEqual(completed.evidence_ref_kinds.map((entry) => entry.kind), ["snapshot_ref", "post_check_ref"]);
  assert.deepEqual(store.get(proof.post_check_ref)?.post_check?.source_refs, proof.source_refs);
  assert.deepEqual(store.get(proof.post_check_ref)?.post_check?.evidence_refs, proof.evidence_refs);
  assert.equal(JSON.stringify(completed).includes("xsec_token"), false);
  assert.equal(store.complete(admitted.entry, {
    ...proof,
    public_summary: { ...proof.public_summary, normalized: { ...publicSummary.normalized, title: "篡改标题" } }
  }), "public_summary_missing");
  assert.equal(store.capture({
    operation_ref: opaqueRef("read_operation"), runtime_session_ref: "session_missing_dom", entry: admitted.entry,
    observed_origin: "https://www.xiaohongshu.com", observed_at: "2026-07-12T00:00:01.000Z",
    source_refs: sources.slice(0, 2), evidence_ref_kinds: [{ kind: "snapshot_ref", ref: opaqueRef("evidence") }],
    public_summary_source_ref: sources[0]!.ref, public_summary: publicSummary
  }), "source_refs_missing");
  assert.equal(store.capture({
    operation_ref: opaqueRef("read_operation"), runtime_session_ref: "session_missing_snapshot", entry: admitted.entry,
    observed_origin: "https://www.xiaohongshu.com", observed_at: "2026-07-12T00:00:03.000Z",
    source_refs: sources, evidence_ref_kinds: [], public_summary_source_ref: sources[0]!.ref, public_summary: publicSummary
  }), "evidence_refs_missing");
  assert.equal(store.capture({
    operation_ref: opaqueRef("read_operation"), runtime_session_ref: "session_missing_dom_citation", entry: admitted.entry,
    observed_origin: "https://www.xiaohongshu.com", observed_at: "2026-07-12T00:00:04.000Z",
    source_refs: sources, evidence_ref_kinds: [{ kind: "snapshot_ref", ref: opaqueRef("evidence") }], public_summary_source_ref: sources[0]!.ref,
    public_summary: { ...publicSummary, normalized: { ...publicSummary.normalized, source_citation: { ...publicSummary.normalized.source_citation, field_sources: ["pinia_store_summary", "network_summary"] } } }
  }), "public_summary_missing");
  assert.equal(store.capture({
    operation_ref: opaqueRef("read_operation"), runtime_session_ref: "session_extra_source", entry: admitted.entry,
    observed_origin: "https://www.xiaohongshu.com", observed_at: "2026-07-12T00:00:02.000Z",
    source_refs: [...sources, { kind: "unexpected_summary", ref: opaqueRef("source") }],
    evidence_ref_kinds: [{ kind: "snapshot_ref", ref: opaqueRef("evidence") }],
    public_summary_source_ref: sources[0]!.ref, public_summary: publicSummary
  }), "source_refs_missing");
  assert.equal(store.complete(admitted.entry, {
    ...proof,
    evidence_ref_kinds: proof.evidence_ref_kinds.map((entry) => entry.kind === "snapshot_ref" ? { ...entry, kind: "mutated_snapshot_ref" } : entry)
  }), "evidence_refs_missing");
});

test("fails closed when the live probe lacks an operation-specific surface or required signal", () => {
  const xhsInput = {
    site_id: "xiaohongshu" as const,
    operation_id: "xhs_search_notes" as const,
    query: "AI",
    target_url: "https://www.xiaohongshu.com/search_result?keyword=AI",
    expected_origin: "https://www.xiaohongshu.com"
  };
  const readyXhs = {
    origin: "https://www.xiaohongshu.com",
    pathname: "/search_result",
    search: "?keyword=AI",
    ready: true,
    pinia_ready: true,
    list_valid: true,
    note_count: 1,
    detail_urls: ["https://www.xiaohongshu.com/explore/0123456789abcdef01234567"],
    search_items: [{ title: "公开笔记", author_display_name: "公开作者", interaction_metrics: { likes: "10" } }],
    operation_response_status: 200,
    operation_response_url: "https://so.xiaohongshu.com/api/sns/web/v2/search/notes",
    xhs_response: {
      status: "completed" as const,
      detail_urls: [
        "https://www.xiaohongshu.com/explore/aaaaaaaaaaaaaaaaaaaaaaaa?xsec_token=other-navigation-token&xsec_source=pc_search",
        "https://www.xiaohongshu.com/explore/0123456789abcdef01234567?xsec_token=opaque-navigation-token&xsec_source=pc_search"
      ],
      search_items: [
        { title: "其他公开笔记" },
        { title: "公开笔记", author_display_name: "公开作者", interaction_metrics: { likes: "10" } }
      ]
    }
  };
  assert.equal(validateReadOperationProbe(xhsInput, { ...readyXhs, pathname: "/settings" }).status, "unavailable");
  assert.equal(validateReadOperationProbe(xhsInput, { ...readyXhs, pathname: "/search_result/" }).status, "completed");
  assert.equal(validateReadOperationProbe(xhsInput, { ...readyXhs, search: "?keyword=other" }).status, "unavailable");
  assert.equal(validateReadOperationProbe(xhsInput, { ...readyXhs, search: "" }).status, "unavailable");
  assert.equal(validateReadOperationProbe(xhsInput, { ...readyXhs, search: "?keyword=AI&keyword=AI" }).status, "unavailable");
  assert.equal(validateReadOperationProbe(xhsInput, { ...readyXhs, pinia_ready: false }).status, "unavailable");
  assert.equal(validateReadOperationProbe(xhsInput, { ...readyXhs, operation_response_status: undefined }).status, "unavailable");
  const hydratingXhs = validateReadOperationProbe(xhsInput, {
    ...readyXhs,
    list_valid: false,
    list_failure: "empty_result",
    note_count: 0,
    detail_urls: []
  });
  assert.equal(failureClass(hydratingXhs), "page_not_ready");
  if (hydratingXhs.status === "unavailable") assert.equal(hydratingXhs.retryable, true);
  const emptyXhs = validateReadOperationProbe(xhsInput, {
    ...readyXhs,
    list_valid: false,
    list_failure: "empty_result",
    note_count: 0,
    detail_urls: [],
    xhs_response: summarizeXhsSearchResponse(JSON.stringify({ success: true, code: 0, data: { items: [] } }))
  });
  assert.equal(failureClass(emptyXhs), "empty_result");
  if (emptyXhs.status === "unavailable") assert.equal(emptyXhs.retryable, false);
  const settlingEmptyXhs = validateReadOperationProbe(xhsInput, {
    ...readyXhs,
    list_valid: false,
    list_failure: "page_not_ready",
    note_count: 0,
    detail_urls: [],
    xhs_response: summarizeXhsSearchResponse(JSON.stringify({ success: true, code: 0, data: { items: [] } }))
  });
  assert.equal(failureClass(settlingEmptyXhs), "page_not_ready");
  if (settlingEmptyXhs.status === "unavailable") assert.equal(settlingEmptyXhs.retryable, true);
  assert.equal(failureClass(validateReadOperationProbe(xhsInput, { ...readyXhs, list_valid: false, list_failure: "page_not_ready", note_count: 0, detail_urls: [] })), "page_not_ready");
  assert.equal(failureClass(validateReadOperationProbe(xhsInput, { ...readyXhs, list_valid: false, list_failure: "site_changed" })), "site_changed");
  assert.equal(failureClass(validateReadOperationProbe(xhsInput, { ...readyXhs, detail_urls: [] })), "site_changed");
  assert.equal(failureClass(validateReadOperationProbe(xhsInput, { ...readyXhs, detail_urls: ["https://evil.example/explore/0123456789abcdef01234567"] })), "site_changed");
  assert.equal(failureClass(validateReadOperationProbe(xhsInput, { ...readyXhs, detail_urls: ["https://www.xiaohongshu.com/explore/not-a-note"] })), "site_changed");
  assert.equal(failureClass(validateReadOperationProbe(xhsInput, { ...readyXhs, search_items: [{ title: "不匹配标题" }] })), "site_changed");
  assert.equal(failureClass(validateReadOperationProbe({ ...xhsInput, limit: 1 }, {
    ...readyXhs,
    note_count: 2,
    detail_urls: [
      "https://www.xiaohongshu.com/explore/0123456789abcdef01234567",
      "https://www.xiaohongshu.com/explore/aaaaaaaaaaaaaaaaaaaaaaaa"
    ],
    search_items: [{ title: "公开笔记" }, { title: "其他公开笔记" }]
  })), "site_changed");
  assert.equal(failureClass(validateReadOperationProbe(xhsInput, { ...readyXhs, challenge_like: true })), "safety_challenge");
  assert.equal(validateReadOperationProbe(xhsInput, { ...readyXhs, pathname: "/" }).status, "unavailable");

  const bossInput = {
    site_id: "boss" as const,
    operation_id: "boss_job_search" as const,
    query: "AI",
    city_code: "101010100",
    target_url: "https://www.zhipin.com/web/geek/job?query=AI&city=101010100",
    expected_origin: "https://www.zhipin.com"
  };
  const readyBoss = {
    origin: "https://www.zhipin.com",
    pathname: "/web/geek/job",
    search: "?query=AI&city=101010100",
    ready: true,
    rendered_surface: true,
    operation_response_status: 200,
    operation_response_url: "https://www.zhipin.com/wapi/zpgeek/search/joblist.json?query=AI&city=101010100",
    boss_response: { status: "completed" as const, business_code: 0 as const, job_count: 2 }
  };
  assert.equal(validateReadOperationProbe(bossInput, { ...readyBoss, pathname: "/web/geek/jobs" }).status, "unavailable");
  assert.equal(validateReadOperationProbe(bossInput, readyBoss).status, "completed");
  assert.equal(validateReadOperationProbe(bossInput, { ...readyBoss, operation_response_status: 500 }).status, "unavailable");
  assert.equal(validateReadOperationProbe(bossInput, { ...readyBoss, search: "?query=other&city=101010100" }).status, "unavailable");
  assert.equal(validateReadOperationProbe(bossInput, { ...readyBoss, search: "?query=AI&city=101010100&extra=1" }).status, "unavailable");
  assert.equal(failureClass(validateReadOperationProbe(bossInput, { ...readyBoss, search: "?query=AI&city=101020100" })), "city_unresolved");
  assert.equal(validateReadOperationProbe(bossInput, { ...readyBoss, operation_response_url: "https://www.zhipin.com/wapi/zpgeek/search/joblist.json?query=other&city=101010100" }).status, "unavailable");
  assert.equal(validateReadOperationProbe(bossInput, { ...readyBoss, operation_response_url: "https://www.zhipin.com/wapi/zpgeek/search/joblist.json?query=AI&city=101020100" }).status, "unavailable");
  assert.equal(failureClass(validateReadOperationProbe(bossInput, { ...readyBoss, login_like: true })), "not_logged_in");
  assert.equal(failureClass(validateReadOperationProbe(bossInput, { ...readyBoss, challenge_like: true })), "safety_challenge");
  assert.equal(failureClass(validateReadOperationProbe(bossInput, { ...readyBoss, rendered_surface: false })), "page_not_ready");
  assert.equal(validateReadOperationProbe(xhsInput, { ...readyXhs, operation_response_url: "https://so.xiaohongshu.com/api/sns/web/v2/search/notes?opaque=ignored" }).status, "completed");
  for (const [input, ready, url] of [
    [xhsInput, readyXhs, "https://www.xiaohongshu.com/api/sns/web/v1/search/notes?keyword=AI"],
    [xhsInput, readyXhs, "https://so.xiaohongshu.com/api/sns/web/v1/search/notes"],
    [xhsInput, readyXhs, "https://so.xiaohongshu.com/api/sns/web/v2/search/notes/extra"],
    [xhsInput, readyXhs, "https://so.xiaohongshu.com.evil.test/api/sns/web/v2/search/notes"],
    [xhsInput, readyXhs, "http://so.xiaohongshu.com/api/sns/web/v2/search/notes"],
    [bossInput, readyBoss, "https://www.zhipin.com/wapi/zpgeek/search/joblist.json?query=AI&city=101010100&extra=1"],
    [bossInput, readyBoss, "https://www.zhipin.com/wapi/zpgeek/search/joblist.json?query=AI&city=101010100#fragment"],
    [bossInput, readyBoss, "https://www.zhipin.com/wapi/zpgeek/search/joblist.json?query=AI&city=101010100#"],
    [bossInput, readyBoss, "https://www.zhipin.com/wapi/zpgeek/search/joblist.json?query=AI&city=101010100&query=AI"],
    [bossInput, readyBoss, "https://www.zhipin.com/wapi/zpgeek/search/joblist.json?query=AI&city=101010100&"],
    [bossInput, readyBoss, "https://www.zhipin.com/wapi/zpgeek/search/joblist.json?query=AI&city=101010100&&"],
    [bossInput, readyBoss, "https://www.zhipin.com/wapi/zpgeek/search/joblist.json"]
  ] as const) {
    assert.equal(validateReadOperationProbe(input, { ...ready, operation_response_url: url }).status, "unavailable");
  }
});

test("validates both detail surfaces against the exact search-bound target", () => {
  const xhsInput = {
    site_id: "xiaohongshu" as const,
    operation_id: "xhs_read_note_detail" as const,
    detail_ref: opaqueRef("detail_ref"),
    target_url: "https://www.xiaohongshu.com/explore/0123456789abcdef01234567",
    expected_origin: "https://www.xiaohongshu.com"
  };
  const ready = {
    origin: "https://www.xiaohongshu.com",
    pathname: "/explore/0123456789abcdef01234567",
    ready: true,
    rendered_surface: true,
    vue_ready: true,
    pinia_ready: true,
    operation_response_status: 200,
    operation_response_url: xhsInput.target_url,
    normalized: {
      kind: "xiaohongshu_note_detail" as const,
      canonical_url: "https://www.xiaohongshu.com/explore/0123456789abcdef01234567",
      note_id: "0123456789abcdef01234567",
      title: "公开标题",
      summary: "公开摘要",
      body_summary: "公开正文摘要",
      author: { display_name: "公开作者", author_id: "author_123", profile_url: "https://www.xiaohongshu.com/user/profile/author_123" },
      interaction_metrics: { likes: "10", comments: "2", collects: "3", shares: "1" },
      source_status: "located" as const
    }
  };
  const xhsCompleted = validateReadOperationProbe(xhsInput, ready);
  assert.equal(xhsCompleted.status, "completed");
  if (xhsCompleted.status === "completed") {
    assert.deepEqual(xhsCompleted.source_kinds, ["pinia_store_summary", "network_summary", "dom_snapshot_summary"]);
    assert.deepEqual(xhsCompleted.public_summary.normalized?.kind === "xiaohongshu_note_detail" ? xhsCompleted.public_summary.normalized.source_citation.field_sources : [], ["pinia_store_summary", "network_summary", "dom_snapshot_summary"]);
    const admitted = admitAllowlistedReadOperation({ site_id: "xiaohongshu", operation_id: "xhs_read_note_detail", detail_ref: xhsInput.detail_ref });
    if (typeof admitted === "string") throw new Error(`XHS detail admission failed: ${admitted}`);
    const store = new ReadOperationObservationStore();
    const sourceRefs = xhsCompleted.source_kinds.map((kind) => ({ kind, ref: opaqueRef("source") }));
    const proof = store.capture({
      operation_ref: opaqueRef("read_operation"), runtime_session_ref: "session_xhs_launcher_capture", entry: admitted.entry,
      observed_origin: xhsInput.expected_origin, observed_at: "2026-07-12T00:01:00.000Z",
      source_refs: sourceRefs, evidence_ref_kinds: [{ kind: "snapshot_ref", ref: opaqueRef("evidence") }],
      public_summary_source_ref: sourceRefs[0]!.ref, public_summary: xhsCompleted.public_summary
    });
    if (typeof proof === "string") throw new Error(`XHS launcher proof capture failed: ${proof}`);
    assert.notEqual(store.complete(admitted.entry, proof), "source_refs_missing");
  }
  if (xhsCompleted.status === "completed") assert.equal(xhsCompleted.public_summary.normalized?.canonical_url.includes("xsec"), false);
  assert.equal(failureClass(validateReadOperationProbe(xhsInput, { ...ready, pinia_ready: false })), "page_not_ready");
  assert.equal(failureClass(validateReadOperationProbe(xhsInput, { ...ready, vue_ready: false })), "page_not_ready");
  assert.equal(failureClass(validateReadOperationProbe(xhsInput, { ...ready, pinia_ready: false, pathname: "/explore/wrong" })), "site_changed");
  assert.equal(failureClass(validateReadOperationProbe(xhsInput, { ...ready, pinia_ready: false, rendered_surface: false })), "empty_result");
  assert.equal(failureClass(validateReadOperationProbe(xhsInput, { ...ready, normalized: undefined })), "field_missing");
  assert.equal(failureClass(validateReadOperationProbe(xhsInput, { ...ready, normalized: { ...ready.normalized, title: "" } })), "field_missing");
  assert.equal(failureClass(validateReadOperationProbe(xhsInput, { ...ready, pathname: "/explore/aaaaaaaaaaaaaaaaaaaaaaaa" })), "site_changed");
  assert.equal(failureClass(validateReadOperationProbe(xhsInput, { ...ready, rendered_surface: false })), "empty_result");
  assert.equal(failureClass(validateReadOperationProbe(xhsInput, { ...ready, operation_response_url: "https://evil.example/detail" })), "site_changed");
  assert.equal(failureClass(validateReadOperationProbe(xhsInput, { ...ready, login_like: true })), "not_logged_in");
  assert.equal(failureClass(validateReadOperationProbe(xhsInput, { ...ready, challenge_like: true })), "safety_challenge");

  const bossInput = {
    site_id: "boss" as const,
    operation_id: "boss_read_job_detail" as const,
    detail_ref: opaqueRef("detail_ref"),
    target_url: "https://www.zhipin.com/job_detail/AbC_123.html",
    expected_origin: "https://www.zhipin.com"
  };
  const bossDetailResponse = {
    status: "completed" as const,
    title: "AI 工程师",
    summary: "公开职位描述",
    description: "公开职位描述",
    job_status: "available",
    company_name: "公开公司",
    recruiter_name: "公开招聘者",
    recruiter_title: "招聘经理"
  };
  const readyBossDetail = {
    ...ready,
    origin: "https://www.zhipin.com",
    pathname: "/job_detail/AbC_123.html",
    operation_response_url: bossInput.target_url,
    boss_detail_response_status: 200,
    boss_detail_response_url: "https://www.zhipin.com/wapi/zpgeek/job/detail.json?securityId=AbC_123",
    boss_detail_response: bossDetailResponse,
    normalized: {
      kind: "boss_job_detail" as const,
      canonical_url: "https://www.zhipin.com/job_detail/AbC_123.html",
      title: "AI 工程师",
      summary: "公开职位描述",
      job: { title: "AI 工程师", description: "公开职位描述", status: "available" },
      company: { name: "公开公司" },
      recruiter: { name: "公开招聘者", title: "招聘经理" },
      source_status: "located" as const
    }
  };
  const bossCompleted = validateReadOperationProbe(bossInput, readyBossDetail);
  assert.equal(bossCompleted.status, "completed");
  if (bossCompleted.status === "completed") assert.deepEqual(bossCompleted.source_kinds, ["wapi_job_detail_summary", "dom_snapshot_summary"]);
  assert.equal(failureClass(validateReadOperationProbe(bossInput, { ...readyBossDetail, boss_detail_response: undefined, boss_detail_response_url: undefined })), "network_resource_unavailable");
  assert.equal(failureClass(validateReadOperationProbe(bossInput, { ...readyBossDetail, boss_detail_response_url: "https://www.zhipin.com/wapi/zpgeek/job/detail.json?securityId=Other" })), "network_resource_unavailable");
  assert.equal(failureClass(validateReadOperationProbe(bossInput, { ...readyBossDetail, boss_detail_response: { ...bossDetailResponse, title: "错误职位" } })), "site_changed");
  assert.equal(failureClass(validateReadOperationProbe(bossInput, { ...readyBossDetail, normalized: { ...readyBossDetail.normalized, company: { name: "" } } })), "field_missing");

  const longDescription = `负责真实浏览器任务与证据链路。${"持续改进可靠性与安全边界。".repeat(60)}`;
  const longWapi = summarizeBossJobDetailResponse(JSON.stringify({
    code: 0,
    zpData: {
      securityId: "AbC_123",
      jobInfo: { jobName: "AI 工程师", postDescription: longDescription, jobStatus: "available" },
      brandComInfo: { brandName: "公开公司" },
      bossInfo: { name: "公开招聘者", title: "招聘经理" }
    }
  }), "AbC_123");
  if (longWapi.status !== "completed") throw new Error("Long BOSS WAPI summary unexpectedly failed.");
  assert.equal(longWapi.summary.length, 500);
  assert.equal(longWapi.description.length > 500, true);
  const evaluateBossDetail = new Function("document", "location", `return ${readProbeExpression("boss", "", undefined, "boss_read_job_detail")}`);
  const domObservation = evaluateBossDetail({
    readyState: "complete",
    body: { innerText: longDescription },
    querySelector: (selector: string) => {
      if (selector.includes("captcha") || selector.includes("login")) return null;
      if (selector.includes(".job-name")) return { textContent: "AI 工程师" };
      if (selector.includes(".job-sec-text")) return { textContent: longDescription };
      if (selector.includes(".company-info")) return { textContent: "公开公司" };
      if (selector.includes(".boss-name")) return { textContent: "公开招聘者" };
      if (selector.includes(".boss-info-attr")) return { textContent: "招聘经理" };
      if (selector.includes(".job-detail-box")) return {};
      return null;
    }
  }, { origin: "https://www.zhipin.com", pathname: "/job_detail/AbC_123.html" });
  assert.equal(domObservation.normalized.summary.length, 500);
  assert.equal(domObservation.normalized.job.description, longDescription);
  const longReady = {
    ...readyBossDetail,
    boss_detail_response: longWapi,
    normalized: domObservation.normalized
  };
  assert.equal(validateReadOperationProbe(bossInput, longReady).status, "completed");
  assert.equal(failureClass(validateReadOperationProbe(bossInput, {
    ...longReady,
    normalized: { ...longReady.normalized, job: { ...longReady.normalized.job, description: `${longDescription}不一致` } }
  })), "site_changed");
});

test("summarizes only a successful BOSS WAPI job list and fails closed for empty 2xx shells", () => {
  assert.deepEqual(summarizeBossJobSearchResponse('{"code":0,"zpData":{"jobList":[{},{}]}}'), {
    status: "completed",
    business_code: 0,
    job_count: 2
  });
  assert.equal(failureClass(summarizeBossJobSearchResponse('{"code":1,"zpData":{"jobList":[{}]}}')), "permission_denied");
  assert.equal(failureClass(summarizeBossJobSearchResponse('{"code":0,"zpData":{"jobList":[]}}')), "empty_result");
  assert.equal(failureClass(summarizeBossJobSearchResponse('{"code":0,"zpData":{"jobList":[null]}}')), "empty_result");
  assert.equal(failureClass(summarizeBossJobSearchResponse('{"code":0,"zpData":{}}')), "site_changed");
  assert.equal(JSON.stringify(summarizeBossJobSearchResponse('{"code":0,"zpData":{"jobList":[{"secret":"not returned"}]}}')).includes("secret"), false);
});

test("summarizes only XHS note ids and private navigation targets from the bounded search response", () => {
  const summary = summarizeXhsSearchResponse(JSON.stringify({
    success: true,
    code: 0,
    data: {
      items: [{ model_type: "rec_query" }, {
        id: "0123456789abcdef01234567",
        xsec_token: "opaque-navigation-token=",
        note_card: {
          id: "0123456789abcdef01234567",
          display_title: "公开笔记",
          user: { nickname: "公开作者", private: "not returned" },
          interact_info: { liked_count: 128, comment_count: "12", collected_count: "34" }
        },
        private: "not returned"
      }]
    }
  }));
  assert.deepEqual(summary, {
    status: "completed",
    detail_urls: ["https://www.xiaohongshu.com/explore/0123456789abcdef01234567?xsec_token=opaque-navigation-token%3D&xsec_source=pc_search"],
    search_items: [{
      title: "公开笔记",
      author_display_name: "公开作者",
      interaction_metrics: { likes: "128", comments: "12", collects: "34" }
    }]
  });
  assert.equal(failureClass(summarizeXhsSearchResponse('{"success":false,"code":-1,"data":{"items":[]}}')), "permission_denied");
  assert.equal(failureClass(summarizeXhsSearchResponse('{"success":true,"code":0,"data":{"items":[]}}')), "empty_result");
  assert.equal(failureClass(summarizeXhsSearchResponse('{"success":true,"code":0,"data":{"items":[{"id":"0123456789abcdef01234567"}]}}')), "site_changed");
  assert.equal(failureClass(summarizeXhsSearchResponse('{"data":{"items":[{"id":"0123456789abcdef01234567","xsec_token":"token"}]}}')), "site_changed");
  assert.equal(failureClass(summarizeXhsSearchResponse('{"success":true,"code":0,"data":{"items":[{"id":"0123456789abcdef01234567","xsec_token":"token","note_card":{"id":"fedcba987654321001234567"}}]}}')), "site_changed");
  assert.equal(failureClass(summarizeXhsSearchResponse('{"success":true,"code":0,"data":{"items":[{"id":"0123456789abcdef01234567","note_id":"fedcba987654321001234567","xsec_token":"token"}]}}')), "site_changed");
  assert.equal(summarizeXhsSearchResponse('{"success":true,"code":0,"data":{"items":[{"id":"0123456789abcdef01234567","xsec_token":"","note_card":{"id":"0123456789abcdef01234567","xsec_token":"valid-token","display_title":"公开笔记"}}]}}').status, "completed");
  assert.deepEqual(summarizeXhsSearchResponse('{"success":true,"code":0,"data":{"items":[{"id":"aaaaaaaaaaaaaaaaaaaaaaaa","xsec_token":"placeholder-token","note_card":{"id":"aaaaaaaaaaaaaaaaaaaaaaaa"}},{"id":"0123456789abcdef01234567","xsec_token":"valid-token","note_card":{"id":"0123456789abcdef01234567","display_title":"公开笔记"}}]}}'), {
    status: "completed",
    detail_urls: ["https://www.xiaohongshu.com/explore/0123456789abcdef01234567?xsec_token=valid-token&xsec_source=pc_search"],
    search_items: [{ title: "公开笔记" }]
  });
  assert.equal(failureClass(summarizeXhsSearchResponse('{"success":true,"code":0,"data":{"items":[{"id":"0123456789abcdef01234567","xsec_token":"invalid=token"}]}}')), "site_changed");
  assert.equal(failureClass(summarizeXhsSearchResponse('{"success":true,"code":0,"data":{"items":[{"id":"0123456789abcdef01234567","xsec_token":"token-a","note_card":{"id":"0123456789abcdef01234567","xsec_token":"token-b"}}]}}')), "site_changed");
  assert.equal(failureClass(summarizeXhsSearchResponse('{"success":true,"code":0,"data":{"items":[{"id":"0123456789abcdef01234567","xsec_token":"token","note_card":{"id":"0123456789abcdef01234567"}}]}}')), "field_missing");
  assert.equal(failureClass(summarizeXhsSearchResponse('{"success":true,"code":0,"data":{"items":[{"id":"0123456789abcdef01234567","xsec_token":"token","note_card":{"id":"0123456789abcdef01234567","display_title":"#access_token=secret"}}]}}')), "field_missing");
  assert.equal(JSON.stringify(summary).includes("not returned"), false);
});

test("keeps XHS private navigation parameters out of public page facts", () => {
  const facts = readOperationPageFacts("https://www.xiaohongshu.com/explore/0123456789abcdef01234567?xsec_token=private-token&xsec_source=pc_search");
  assert.equal(facts.current_url, "https://www.xiaohongshu.com/explore/0123456789abcdef01234567");
  assert.equal(JSON.stringify(facts).includes("xsec_"), false);
  assert.equal(JSON.stringify(facts).includes("private-token"), false);
});

test("summarizes only a target-bound BOSS detail WAPI response without raw identifiers", () => {
  const body = JSON.stringify({
    code: 0,
    zpData: {
      securityId: "AbC_123",
      encryptJobId: "private-job-id",
      jobInfo: { securityId: "AbC_123", jobName: "AI 工程师", postDescription: "公开职位描述", jobStatus: "available", salaryDesc: "20-30K", locationName: "上海" },
      brandComInfo: { brandName: "公开公司" },
      bossInfo: { name: "公开招聘者", title: "招聘经理" }
    }
  });
  const summary = summarizeBossJobDetailResponse(body, "AbC_123");
  assert.equal(summary.status, "completed");
  assert.equal(JSON.stringify(summary).includes("securityId"), false);
  assert.equal(JSON.stringify(summary).includes("encryptJobId"), false);
  assert.equal(JSON.stringify(summary).includes("private-job-id"), false);
  assert.equal(failureClass(summarizeBossJobDetailResponse(body, "Other_456")), "site_changed");
  assert.equal(failureClass(summarizeBossJobDetailResponse('{"code":0,"zpData":{}}', "AbC_123")), "site_changed");
});

function failureClass(result: { status: string; failure_class?: string }): string | undefined {
  return result.failure_class;
}
