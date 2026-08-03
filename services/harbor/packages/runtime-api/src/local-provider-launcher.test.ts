import assert from "node:assert/strict";
import test from "node:test";
import { readTargetPageFacts, selectPage } from "./local-provider-launcher.js";

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
