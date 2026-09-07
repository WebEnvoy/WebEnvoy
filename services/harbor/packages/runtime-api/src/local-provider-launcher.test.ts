import assert from "node:assert/strict";
import test from "node:test";
import {
  imageFileInputProbeExpression,
  imageUploadPathProbeExpression,
  observeXhsPathPrepareRequest,
  providerConfigurationPageUrl,
  readTargetPageFacts,
  sameWritePrecheckUrl,
  selectPage,
  validateXhsWritePrecheckObservation,
  writePrecheckProbeExpression
} from "./local-provider-launcher.js";

test("creator publish sessions warm the existing Xiaohongshu login before opening creator", () => {
  const identity_environment = { site_binding: { site_id: "xiaohongshu" } } as never;
  assert.equal(providerConfigurationPageUrl({
    url: "https://creator.xiaohongshu.com/publish/publish",
    identity_environment
  } as never), "https://www.xiaohongshu.com/explore");
  assert.equal(providerConfigurationPageUrl({
    url: "https://example.com/publish/publish",
    identity_environment
  } as never), "https://example.com/publish/publish");
});

test("creator publish URL accepts only the bounded tab-switch redirect", () => {
  const target = "https://creator.xiaohongshu.com/publish/publish";
  assert.equal(sameWritePrecheckUrl(`${target}?from=tab_switch`, target), true);
  assert.equal(sameWritePrecheckUrl(`${target}?from=other`, target), false);
  assert.equal(sameWritePrecheckUrl(`${target}?from=tab_switch&extra=1`, target), false);
  assert.equal(sameWritePrecheckUrl(`https://attacker.example/publish/publish?from=tab_switch`, target), false);
});

test("selectPage matches equivalent page URLs by structured URL semantics", () => {
  const requestedUrl = "https://www.xiaohongshu.com/search_result?keyword=AI%20%E5%B7%A5%E5%85%B7&source=web#notes";
  const selected = selectPage([
    { id: "wrong", type: "page", url: "https://www.xiaohongshu.com/explore", webSocketDebuggerUrl: "ws://wrong" },
    {
      id: "target",
      type: "page",
      url: "https://www.xiaohongshu.com/search_result?source=web&keyword=AI+%E5%B7%A5%E5%85%B7#notes",
      webSocketDebuggerUrl: "ws://target"
    }
  ], requestedUrl);
  assert.equal(selected?.id, "target");
});

test("selectPage does not fall back to a different page when the requested URL is absent", () => {
  const selected = selectPage([
    { id: "first", type: "page", url: "https://attacker.example/search_result?keyword=x", webSocketDebuggerUrl: "ws://first" },
    { id: "second", type: "page", url: "https://www.xiaohongshu.com/explore", webSocketDebuggerUrl: "ws://second" }
  ], "https://www.xiaohongshu.com/search_result?keyword=x");
  assert.equal(selected, undefined);
});

test("selectPage preserves a redirect when it is the only page target", () => {
  const selected = selectPage([
    { id: "redirect", type: "page", url: "https://www.zhipin.com/web/passport/zp/verify.html?code=35", webSocketDebuggerUrl: "ws://redirect" }
  ], "https://www.zhipin.com/web/geek/job");
  assert.equal(selected?.id, "redirect");
});

test("selectPage accepts the bounded Xiaohongshu search type redirect", () => {
  const requestedUrl = "https://www.xiaohongshu.com/search_result?keyword=citywalk&source=web_search_result_notes";
  const aboutBlank = { id: "blank", type: "page", url: "about:blank", webSocketDebuggerUrl: "ws://blank" };
  const redirected = { id: "target", type: "page", url: `${requestedUrl}&type=51`, webSocketDebuggerUrl: "ws://target" };

  assert.equal(selectPage([aboutBlank, redirected], requestedUrl)?.id, "target");
  for (const suffix of ["type=50", "type=51&extra=1", "type=51&type=51"]) {
    assert.equal(selectPage([
      aboutBlank,
      { ...redirected, url: `${requestedUrl}&${suffix}` }
    ], requestedUrl), undefined);
  }
});

test("selectPage accepts only the bounded creator tab-switch redirect with other tabs present", () => {
  const requestedUrl = "https://creator.xiaohongshu.com/publish/publish";
  const explore = { id: "explore", type: "page", url: "https://www.xiaohongshu.com/explore", webSocketDebuggerUrl: "ws://explore" };
  const creator = { id: "creator", type: "page", url: `${requestedUrl}?from=tab_switch`, webSocketDebuggerUrl: "ws://creator" };

  assert.equal(selectPage([explore, creator], requestedUrl)?.id, "creator");
  assert.equal(selectPage([explore, { ...creator, url: `${requestedUrl}?from=other` }], requestedUrl), undefined);
});

test("selectPage prefers an exact URL and preserves repeated query parameter order", () => {
  const requestedUrl = "https://www.xiaohongshu.com/search_result?tag=first&tag=second";
  const reordered = { id: "reordered", type: "page", url: "https://www.xiaohongshu.com/search_result?tag=second&tag=first", webSocketDebuggerUrl: "ws://reordered" };
  const unrelated = { id: "unrelated", type: "page", url: "https://www.xiaohongshu.com/explore", webSocketDebuggerUrl: "ws://unrelated" };
  assert.equal(selectPage([reordered, unrelated], requestedUrl), undefined);
  const selected = selectPage([
    reordered,
    unrelated,
    { id: "exact", type: "page", url: "https://www.xiaohongshu.com/search_result?tag=first&tag=second", webSocketDebuggerUrl: "ws://exact" }
  ], requestedUrl);
  assert.equal(selected?.id, "exact");
});

test("selectPage only applies structured equivalence to HTTP URLs", () => {
  const selected = selectPage([
    { id: "javascript", type: "page", url: "javascript:blank", webSocketDebuggerUrl: "ws://javascript" },
    { id: "about", type: "page", url: "about:blank", webSocketDebuggerUrl: "ws://about" }
  ], "about:blank");
  assert.equal(selected?.id, "about");
});

test("readTargetPageFacts fails closed when the requested target is unavailable", async () => {
  const page = await readTargetPageFacts(undefined, "https://www.xiaohongshu.com/search_result?keyword=x");
  assert.equal(page.status, "unavailable");
  assert.equal(page.current_url, null);
  assert.equal(page.error?.code, "url_unreachable");
});

test("reads binary CDP messages without waiting for the command timeout", async () => {
  class BinaryCdpWebSocket extends EventTarget {
    readyState = 0;
    binaryType: BinaryType = "blob";

    constructor(_url: string | URL) {
      super();
      queueMicrotask(() => {
        this.readyState = 1;
        this.dispatchEvent(new Event("open"));
      });
    }

    send(payload: string): void {
      const message = JSON.parse(payload) as { id: number; method: string };
      const result = message.method === "Runtime.evaluate"
        ? { result: { value: { title: "Binary page", url: "https://www.xiaohongshu.com/explore", readyState: "complete" } } }
        : {};
      const bytes = new TextEncoder().encode(JSON.stringify({ id: message.id, result }));
      const data = this.binaryType === "arraybuffer" ? bytes.buffer : new Blob([bytes]);
      queueMicrotask(() => this.dispatchEvent(new MessageEvent("message", { data })));
    }

    close(): void {
      this.readyState = 3;
      this.dispatchEvent(new Event("close"));
    }
  }

  const originalWebSocket = globalThis.WebSocket;
  globalThis.WebSocket = BinaryCdpWebSocket as unknown as typeof WebSocket;
  try {
    const page = await readTargetPageFacts({
      id: "binary",
      type: "page",
      url: "https://www.xiaohongshu.com/explore",
      title: "Fallback page",
      webSocketDebuggerUrl: "ws://127.0.0.1/binary"
    }, "https://www.xiaohongshu.com/explore", AbortSignal.timeout(100));
    assert.equal(page.title, "Binary page");
  } finally {
    globalThis.WebSocket = originalWebSocket;
  }
});

test("#405 path probe maps only the requested exact visible label and keeps file selection out", () => {
  const upload = writePrecheckProbeExpression("image_text_upload", true);
  const generate = writePrecheckProbeExpression("image_text_generate", true);
  assert.match(upload, /上传图文/);
  assert.match(generate, /文字配图/);
  assert.match(upload, /selectPath = true/);
  assert.match(upload, /strictPath = true/);
  assert.match(upload, /pathLabels = \["上传图文"\]/);
  assert.match(upload, /input\[type=["']file["']\]/);
  assert.doesNotMatch(upload, /normalizeControlLabel\(el\)\.includes/);
  assert.match(upload, /!strictPath && label\(el\)\.includes/);
  assert.match(upload, /\[role=\\?"tab\\?"\].*aria-controls.*aria-selected/);
  assert.match(upload, /\.header-tabs \.creator-tab/);
  assert.match(upload, /controls\.length !== 1/);
  assert.match(upload, /!el\.disabled && el\.getAttribute\('aria-disabled'\) !== 'true'/);
  assert.match(upload, /Number\(style\.opacity\) >= 0\.01/);
  assert.match(upload, /rect\.right > 0.*rect\.left < innerWidth/);
  assert.match(upload, /el\.checkVisibility\(\{ checkOpacity: true, checkVisibilityCSS: true \}\)/);
  assert.match(upload, /const visible = \(el, allowDisabled = true\)/);
  assert.match(upload, /strictPath \? controls\.filter\(\(el\) => visible\(el, false\)\) : controls/);
  assert.doesNotMatch(upload, /querySelectorAll\('button, \[role="button"\], \[role="tab"\]'\)/);
  assert.doesNotMatch(upload, /files\s*\.\s*\w+|setInputFiles/);
});

test("#405 path probe does not click a data-testid decoy", async () => {
  let clicks = 0;
  const app = {
    hidden: false,
    contains: () => true,
    closest: () => null,
    getBoundingClientRect: () => ({ width: 100, height: 100, right: 100, bottom: 100, left: 0, top: 0 }),
    checkVisibility: () => true,
    querySelectorAll: () => []
  };
  const decoy = {
    disabled: false,
    hidden: false,
    textContent: "上传图文",
    getAttribute: () => null,
    closest: (selector: string) => selector.includes('[data-testid*="decoy"]') ? {} : null,
    getBoundingClientRect: () => ({ width: 20, height: 20, right: 21, bottom: 21, left: 1, top: 1 }),
    checkVisibility: () => true,
    querySelector: () => null,
    click: () => { clicks += 1; }
  };
  const document = {
    body: { innerText: "" },
    querySelector: () => app,
    querySelectorAll: (selector: string) => selector.includes("login") ? [] : [decoy]
  };
  const evaluate = new Function(
    "document", "location", "getComputedStyle", "innerWidth", "innerHeight", "HTMLInputElement", "setTimeout",
    `return ${writePrecheckProbeExpression("image_text_upload", true)}`
  );
  const result = await evaluate(
    document,
    { href: "https://creator.xiaohongshu.com/publish/publish", origin: "https://creator.xiaohongshu.com", pathname: "/publish/publish" },
    () => ({ display: "block", visibility: "visible", pointerEvents: "auto", opacity: "1", zIndex: "0" }),
    100,
    100,
    class {},
    (resolve: () => void) => resolve()
  );
  assert.equal(result.selection_status, "unknown");
  assert.equal(clicks, 0);
});

test("#405 path request observation continues requests and leaves external effects unknown", () => {
  const continued: string[] = [];
  const continueRequest = (requestId: string) => { continued.push(requestId); };
  assert.equal(observeXhsPathPrepareRequest({ requestId: "get", resourceType: "XHR", request: { method: "GET" } }, continueRequest), false);
  assert.equal(observeXhsPathPrepareRequest({ requestId: "head", resourceType: "Document", request: { method: "HEAD" } }, continueRequest), false);
  assert.equal(observeXhsPathPrepareRequest({ requestId: "options", resourceType: "Fetch", request: { method: "OPTIONS" } }, continueRequest), false);
  assert.equal(observeXhsPathPrepareRequest({ requestId: "post", resourceType: "XHR", request: { method: "POST" } }, continueRequest), true);
  assert.equal(observeXhsPathPrepareRequest({ requestId: "script-post", resourceType: "Script", request: { method: "POST" } }, continueRequest), false);
  assert.equal(observeXhsPathPrepareRequest({ requestId: "missing-method", resourceType: "XHR", request: {} }, continueRequest), false);
  assert.equal(observeXhsPathPrepareRequest({ resourceType: "XHR", request: { method: "POST" } }, continueRequest), false);
  assert.deepEqual(continued, ["get", "head", "options", "post", "script-post", "missing-method"]);
});

test("#409 media upload targets one app-owned image input without depending on a CSS class", () => {
  const probe = imageFileInputProbeExpression();
  assert.match(probe, /#app input\[type=\"file\"\], \[data-v-app\] input\[type=\"file\"\]/);
  assert.match(probe, /image\\\/\(\?:\\\*\|jpeg\|png\|webp\)/);
  assert.match(probe, /matches\(':disabled'\)/);
  assert.match(probe, /\[aria-disabled=\\?"true\\?"\].*\[data-decoy=\\?"true\\?"\].*\[data-testid\*=\\?"decoy\\?"\].*\.decoy/);
  assert.match(probe, /candidates\.length === 1/);
  assert.doesNotMatch(probe, /input\.upload-input\[type=\"file\"\]/);
});

test("#409 media upload selects only the unique actionable image-text path before resolving the file input", () => {
  const probe = imageUploadPathProbeExpression();
  assert.match(probe, /\.header-tabs \.creator-tab/);
  assert.match(probe, /=== '上传图文'/);
  assert.match(probe, /pathEntries\.length === 1/);
  assert.match(probe, /attempt < 30/);
  assert.match(probe, /document\.elementFromPoint/);
  assert.match(probe, /Number\(style\.opacity\) >= 0\.01/);
  assert.match(probe, /!el\.hidden && !el\.matches\(':disabled'\) && el\.getAttribute\('aria-disabled'\) !== 'true'/);
  assert.match(probe, /\[aria-hidden=\\?"true\\?"\].*\[hidden\].*\[data-decoy=\\?"true\\?"\].*\[data-testid\*=\\?"decoy\\?"\].*\.decoy/);
  assert.match(probe, /!el\.querySelector\('input\[type="file"\]'\)/);
  assert.match(probe, /el\.checkVisibility\(\{ checkOpacity: true, checkVisibilityCSS: true \}\)/);
  assert.match(probe, /image_input_candidate_count/);
  assert.doesNotMatch(probe, /上传视频|文字配图|保存草稿|发布笔记/);
});

test("#409 media upload does not click disabled, decoy, or file-input path entries", async () => {
  let clicks = 0;
  const entry = (blockedBy: "disabled" | "decoy" | "file-input") => ({
    hidden: false,
    textContent: "上传图文",
    matches: () => blockedBy === "disabled",
    getAttribute: (name: string) => name === "aria-disabled" && blockedBy === "disabled" ? "true" : null,
    closest: () => blockedBy === "decoy" ? {} : null,
    querySelector: () => blockedBy === "file-input" ? {} : null,
    getBoundingClientRect: () => ({ x: 1, y: 1, width: 20, height: 20, right: 21, bottom: 21, left: 1, top: 1 }),
    contains: () => false,
    checkVisibility: () => true,
    click: () => { clicks += 1; }
  });
  const entries = [entry("disabled"), entry("decoy"), entry("file-input")];
  const document = {
    querySelectorAll: (selector: string) => selector.includes("input[type=\"file\"]") ? [] : entries,
    elementFromPoint: () => entries[0]
  };
  const evaluate = new Function("document", "getComputedStyle", "innerWidth", "innerHeight", "setTimeout", `return ${imageUploadPathProbeExpression()}`);
  const result = await evaluate(
    document,
    () => ({ display: "block", visibility: "visible", pointerEvents: "auto", opacity: "1" }),
    100,
    100,
    (resolve: () => void) => resolve()
  );
  assert.deepEqual(result, { image_input_candidate_count: 0, image_path_candidate_count: 0 });
  assert.equal(clicks, 0);
});

test("#405 observation preserves path state for the bounded path branch", () => {
  const input = {
    target_url: "https://creator.xiaohongshu.com/publish/publish",
    expected_origin: "https://creator.xiaohongshu.com" as const,
    target_ref: "target-ref:xiaohongshu/creator-publish-page",
    requested_path: "image_text_upload" as const
  };
  const base = {
    url: input.target_url,
    origin: input.expected_origin,
    pathname: "/publish/publish",
    challenge_like: false,
    login_like: false,
    creator_app_owned: true,
    creator_surface_state: "observed" as const,
    creator_root_count: 1,
    upload_image_tab_active: true,
    upload_image_entry_visible: true,
    text_image_entry_visible: true,
    composition_path: "image_text_upload" as const,
    path_observed: "observed" as const,
    path_entry_visible: "observed" as const,
    composition_state: "composition_not_initialized" as const
  };
  assert.equal(validateXhsWritePrecheckObservation(input, { ...base, path_observed: "unobserved" }).status, "completed");
  assert.equal(validateXhsWritePrecheckObservation(input, base).status, "completed");
});
