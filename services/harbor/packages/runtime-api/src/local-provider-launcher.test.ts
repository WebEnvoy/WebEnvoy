import assert from "node:assert/strict";
import test from "node:test";
import { readTargetPageFacts, selectPage, validateXhsWritePrecheckObservation, writePrecheckProbeExpression } from "./local-provider-launcher.js";

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
  assert.match(upload, /上传图片/);
  assert.match(generate, /文字配图/);
  assert.match(upload, /selectPath = true/);
  assert.match(upload, /strictPath = true/);
  assert.match(upload, /pathLabels = \["上传图片"\]/);
  assert.match(upload, /input\[type=["']file["']\]/);
  assert.doesNotMatch(upload, /normalizeControlLabel\(el\)\.includes/);
  assert.match(upload, /!strictPath && label\(el\)\.includes/);
  assert.match(upload, /\[role=\\?"tab\\?"\].*aria-controls.*aria-selected/);
  assert.match(upload, /controls\.length !== 1/);
  assert.match(upload, /!el\.disabled && el\.getAttribute\('aria-disabled'\) !== 'true'/);
  assert.match(upload, /const visible = \(el, allowDisabled = false\)/);
  assert.doesNotMatch(upload, /querySelectorAll\('button, \[role="button"\], \[role="tab"\]'\)/);
  assert.doesNotMatch(upload, /files\s*\.\s*\w+|setInputFiles/);
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
