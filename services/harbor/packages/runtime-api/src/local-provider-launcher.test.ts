import assert from "node:assert/strict";
import test from "node:test";
import {
  blocksXhsMediaActionRequest,
  clickPoint,
  cleanupConfirmationPointExpression,
  commitProbeExpression,
  draftEditPointExpression,
  fieldFillProbeExpression,
  imageFileInputProbeExpression,
  imageUploadPathProbeExpression,
  isCamoufoxLaunchRequest,
  noteManagerNavigationPointExpression,
  observeXhsPathPrepareRequest,
  providerConfigurationPageUrl,
  publishedActionPointExpression,
  readTargetPageFacts,
  sameWritePrecheckUrl,
  selectCleanupPage,
  selectPage,
  validateXhsWritePrecheckObservation,
  writePrecheckProbeExpression,
  xhsContentRef
} from "./local-provider-launcher.js";
import { launchLocalDedicatedProvider } from "./local-provider-launcher.js";

test("retires Camoufox launches before detection or provider fallback", async () => {
  const keys = ["HARBOR_CAMOUFOX_LAUNCH_STATE", "HARBOR_CAMOUFOX_LAUNCH_REASON", "HARBOR_BROWSER_PROVIDER", "HARBOR_BROWSER_PATH"] as const;
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  process.env.HARBOR_CAMOUFOX_LAUNCH_STATE = "retired";
  process.env.HARBOR_CAMOUFOX_LAUNCH_REASON = "retired_binding";
  delete process.env.HARBOR_BROWSER_PROVIDER;
  delete process.env.HARBOR_BROWSER_PATH;
  try {
    const retired = await launchLocalDedicatedProvider({
      browser_path: "/private/tmp/camoufox.app/Contents/MacOS/camoufox",
      provider_id: "camoufox",
      headless: true,
      timeout_ms: 25,
      url: "about:blank",
      profile_ref: "profile-camoufox-retired",
      provider_ref: "provider-camoufox-retired"
    });
    assert.equal(retired.status, "unavailable");
    if (retired.status !== "unavailable") return;
    assert.equal(retired.error.code, "unsupported");
    assert.equal(retired.error.retryable, false);
    assert.match(retired.error.message, /旧补丁运行路线已退役，需要明确选择受支持版本/);
    assert.match(retired.error.message, /尚未通过 Qualification Gate/);
    assert.match(retired.error.message, /不会启动 Camoufox 或自动切换 Provider/);
    assert.equal(retired.facts.some(fact => fact.key === "provider.camoufox.launch_state" && fact.value === "retired"), true);
    assert.equal(retired.facts.some(fact => fact.key === "provider.camoufox.launch_reason" && fact.value === "retired_binding"), true);

    // A caller that explicitly selects a non-Camoufox provider is not blocked
    // by the retirement marker (the management-only scope returns before any
    // browser process is needed).
    const explicitChrome = await launchLocalDedicatedProvider({
      browser_path: "/private/tmp/chrome.app/Contents/MacOS/Google Chrome",
      provider_id: "chrome_official",
      headless: true,
      timeout_ms: 25,
      url: "about:blank",
      profile_ref: "profile-chrome-retirement-marker",
      provider_ref: "provider-chrome-retirement-marker",
      operation_scope: "profile_management"
    });
    assert.equal(explicitChrome.status, "unavailable");
    if (explicitChrome.status !== "unavailable") return;
    assert.equal(explicitChrome.error.code, "provider_unavailable");
    assert.notEqual(explicitChrome.error.code, "unsupported");
  } finally {
    for (const key of keys) {
      const value = previous[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("prioritizes explicit Camoufox provider and legacy binding over non-Camoufox path/env", async () => {
  const previousProvider = process.env.HARBOR_BROWSER_PROVIDER;
  const previousBrowserPath = process.env.HARBOR_BROWSER_PATH;
  delete process.env.HARBOR_BROWSER_PATH;
  process.env.HARBOR_BROWSER_PROVIDER = "chrome_official";
  try {
    const explicitCamoufox = await launchLocalDedicatedProvider({
      browser_path: "/private/tmp/browser",
      provider_id: "camoufox",
      headless: true,
      timeout_ms: 25,
      url: "about:blank",
      profile_ref: "profile-camoufox-priority",
      provider_ref: "provider-camoufox-priority"
    });
    assert.equal(explicitCamoufox.status, "unavailable");
    if (explicitCamoufox.status !== "unavailable") return;
    assert.equal(explicitCamoufox.error.code, "unsupported");
    assert.equal(explicitCamoufox.error.retryable, false);

    // CreateRuntimeSessionInput permits an explicit provider id and path
    // independently. The effective path still wins: a Camoufox path must
    // never reach spawn even when the provider id says Chrome.
    assert.equal(isCamoufoxLaunchRequest({
      browser_path: "/private/tmp/Camoufox.app/Contents/MacOS/camoufox",
      provider_id: "chrome_official"
    }, { HARBOR_BROWSER_PROVIDER: "chrome_official" }), true);
    assert.equal(isCamoufoxLaunchRequest({
      browser_path: "",
      provider_id: "chrome_official"
    }, {
      HARBOR_BROWSER_PROVIDER: "chrome_official",
      HARBOR_BROWSER_PATH: "/private/tmp/Camoufox.app/Contents/MacOS/camoufox"
    }), true);
    const explicitChromeWithCamoufoxPath = await launchLocalDedicatedProvider({
      browser_path: "/private/tmp/Camoufox.app/Contents/MacOS/camoufox",
      provider_id: "chrome_official",
      headless: true,
      timeout_ms: 25,
      url: "about:blank",
      profile_ref: "profile-chrome-with-camoufox-path",
      provider_ref: "provider-chrome-with-camoufox-path",
      operation_scope: "profile_management"
    });
    assert.equal(explicitChromeWithCamoufoxPath.status, "unavailable");
    if (explicitChromeWithCamoufoxPath.status !== "unavailable") return;
    assert.equal(explicitChromeWithCamoufoxPath.error.code, "unsupported");

    // An explicit Chrome path takes precedence over an unrelated Camoufox
    // path left in the environment.
    assert.equal(isCamoufoxLaunchRequest({
      browser_path: "/private/tmp/chrome.app/Contents/MacOS/Google Chrome",
      provider_id: "chrome_official"
    }, {
      HARBOR_BROWSER_PROVIDER: "chrome_official",
      HARBOR_BROWSER_PATH: "/private/tmp/Camoufox.app/Contents/MacOS/camoufox"
    }), false);

    // Without an explicit non-Camoufox provider or managed binding, the
    // configured Camoufox provider owns an opaque effective path as well.
    assert.equal(isCamoufoxLaunchRequest({ browser_path: "" }, {
      HARBOR_BROWSER_PROVIDER: "camoufox",
      HARBOR_BROWSER_PATH: "/private/tmp/stock-browser"
    }), true);
    const previousConfiguredPath = process.env.HARBOR_BROWSER_PATH;
    process.env.HARBOR_BROWSER_PROVIDER = "camoufox";
    process.env.HARBOR_BROWSER_PATH = "/private/tmp/stock-browser";
    try {
      const configuredCamoufox = await launchLocalDedicatedProvider({
        browser_path: "",
        headless: true,
        timeout_ms: 25,
        url: "about:blank",
        profile_ref: "profile-configured-camoufox-opaque-path",
        provider_ref: "provider-configured-camoufox-opaque-path",
        operation_scope: "profile_management"
      });
      assert.equal(configuredCamoufox.status, "unavailable");
      if (configuredCamoufox.status !== "unavailable") return;
      assert.equal(configuredCamoufox.error.code, "unsupported");
      assert.equal(configuredCamoufox.error.retryable, false);
    } finally {
      process.env.HARBOR_BROWSER_PROVIDER = "chrome_official";
      if (previousConfiguredPath === undefined) delete process.env.HARBOR_BROWSER_PATH;
      else process.env.HARBOR_BROWSER_PATH = previousConfiguredPath;
    }

    const legacyBinding = {
      profile_ref: "profile-camoufox-legacy-binding",
      browser_storage: { profile_storage_ref: "profile-storage-camoufox-legacy-binding" },
      provider_binding: {
        selected_provider_id: "camoufox",
        selected_provider: {
          provider_id: "camoufox",
          install: { path: "/private/tmp/camoufox.app/Contents/MacOS/camoufox" }
        }
      }
    } as Parameters<typeof launchLocalDedicatedProvider>[0]["identity_environment"];
    assert.equal(isCamoufoxLaunchRequest({ browser_path: "", identity_environment: legacyBinding }, { HARBOR_BROWSER_PROVIDER: "chrome_official" }), true);
    const retiredBinding = await launchLocalDedicatedProvider({
      browser_path: "",
      identity_environment: legacyBinding,
      headless: true,
      timeout_ms: 25,
      url: "about:blank",
      profile_ref: "profile-camoufox-legacy-binding",
      profile_storage_ref: "profile-storage-camoufox-legacy-binding",
      provider_ref: "provider-camoufox-legacy-binding"
    });
    assert.equal(retiredBinding.status, "unavailable");
    if (retiredBinding.status !== "unavailable") return;
    assert.equal(retiredBinding.error.code, "unsupported");

    const genericBoundCamoufox = {
      profile_ref: "profile-camoufox-generic-binding",
      browser_storage: { profile_storage_ref: "profile-storage-camoufox-generic-binding" },
      provider_binding: {
        selected_provider_id: "camoufox",
        selected_provider: {
          provider_id: "camoufox",
          install: { path: "/private/tmp/browser" }
        }
      }
    } as Parameters<typeof launchLocalDedicatedProvider>[0]["identity_environment"];
    assert.equal(isCamoufoxLaunchRequest({ browser_path: "/private/tmp/browser", identity_environment: genericBoundCamoufox }, { HARBOR_BROWSER_PROVIDER: "chrome_official" }), true);
    const retiredGenericBinding = await launchLocalDedicatedProvider({
      browser_path: "/private/tmp/browser",
      identity_environment: genericBoundCamoufox,
      headless: true,
      timeout_ms: 25,
      url: "about:blank",
      profile_ref: "profile-camoufox-generic-binding",
      profile_storage_ref: "profile-storage-camoufox-generic-binding",
      provider_ref: "provider-camoufox-generic-binding"
    });
    assert.equal(retiredGenericBinding.status, "unavailable");
    if (retiredGenericBinding.status !== "unavailable") return;
    assert.equal(retiredGenericBinding.error.code, "unsupported");

    const explicitChromeConflict = await launchLocalDedicatedProvider({
      browser_path: "",
      identity_environment: legacyBinding,
      provider_id: "chrome_official",
      headless: true,
      timeout_ms: 25,
      url: "about:blank",
      profile_ref: "profile-camoufox-legacy-binding",
      profile_storage_ref: "profile-storage-camoufox-legacy-binding",
      provider_ref: "provider-camoufox-legacy-binding"
    });
    assert.equal(explicitChromeConflict.status, "unavailable");
    if (explicitChromeConflict.status !== "unavailable") return;
    assert.equal(explicitChromeConflict.error.code, "identity_environment_unavailable");
    assert.equal(explicitChromeConflict.facts.some(fact => fact.value === "provider_mismatch"), true);
  } finally {
    if (previousProvider === undefined) delete process.env.HARBOR_BROWSER_PROVIDER;
    else process.env.HARBOR_BROWSER_PROVIDER = previousProvider;
    if (previousBrowserPath === undefined) delete process.env.HARBOR_BROWSER_PATH;
    else process.env.HARBOR_BROWSER_PATH = previousBrowserPath;
  }

});

test("#419 commit readback rejects decoy fields and scopes media to the unique composition", () => {
  const rect = { left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100 };
  let titleDecoy = false;
  let bodyDecoy = false;
  let inputDecoy = false;
  const decoyAncestor = { dataset: { decoy: "" } };
  const title = { value: "WE测试", closest: (selector: string) => titleDecoy && selector.includes("[data-decoy]") ? decoyAncestor : null, getAttribute: () => "填写标题", getBoundingClientRect: () => rect };
  const media = { closest: () => null, getBoundingClientRect: () => rect };
  const decoy = { closest: (selector: string) => selector.includes("[data-decoy]") ? { dataset: { decoy: "" } } : null, getBoundingClientRect: () => rect };
  const imageInput = {
    parentElement: null as unknown,
    matches: () => false,
    closest: (selector: string) => inputDecoy && selector.includes("[data-decoy]") ? decoyAncestor : null,
    getAttribute: () => "",
    getBoundingClientRect: () => ({ ...rect, width: 0, height: 0 })
  };
  const mediaArea = {
    parentElement: null as unknown,
    querySelectorAll: () => [media, decoy]
  };
  const editor: Record<string, unknown> = {
    parentElement: null,
    contains: (value: unknown) => value === title || value === mediaArea,
    querySelectorAll: (selector: string) => selector === "input" ? [title, imageInput] : selector.includes("contenteditable") ? [body] : selector.includes('input[type="file"]') ? [imageInput] : [media, decoy]
  };
  const root: Record<string, unknown> = {
    parentElement: null,
    contains: (value: unknown) => value === title,
    querySelectorAll: (selector: string) => selector === "input" ? [title, imageInput] : selector.includes("contenteditable") ? [body] : selector.includes('input[type="file"]') ? [imageInput] : [media, decoy]
  };
  editor.parentElement = root;
  mediaArea.parentElement = editor;
  imageInput.parentElement = mediaArea;
  const body = { textContent: "正文 WE-XHS-E2E-1", parentElement: editor, closest: (selector: string) => bodyDecoy && selector.includes("[data-decoy]") ? decoyAncestor : null, contains: () => false, getBoundingClientRect: () => rect, querySelectorAll: () => [] };
  const document = { body: { innerText: "" }, querySelectorAll: () => [root] };
  const evaluate = new Function("document", "location", "getComputedStyle", `return ${commitProbeExpression("WE-XHS-E2E-1", "WE测试")}`);
  const result = evaluate(document, { href: "https://creator.xiaohongshu.com/publish/update", pathname: "/publish/update" }, () => ({ display: "block", visibility: "visible" }));
  assert.equal(result.fields_matched, true);
  assert.equal(result.media_count, 1);
  titleDecoy = true;
  assert.equal(evaluate(document, { href: "https://creator.xiaohongshu.com/publish/update", pathname: "/publish/update" }, () => ({ display: "block", visibility: "visible" })).fields_matched, false);
  titleDecoy = false;
  bodyDecoy = true;
  assert.equal(evaluate(document, { href: "https://creator.xiaohongshu.com/publish/update", pathname: "/publish/update" }, () => ({ display: "block", visibility: "visible" })).marker_matched, false);
  bodyDecoy = false;
  inputDecoy = true;
  assert.equal(evaluate(document, { href: "https://creator.xiaohongshu.com/publish/update", pathname: "/publish/update" }, () => ({ display: "block", visibility: "visible" })).media_count, 0);
  inputDecoy = false;
  title.value = "已被改名";
  assert.equal(evaluate(document, { href: "https://creator.xiaohongshu.com/publish/update", pathname: "/publish/update" }, () => ({ display: "block", visibility: "visible" })).fields_matched, false);
  title.value = "WE测试";
  mediaArea.querySelectorAll = () => [];
  assert.equal(evaluate(document, { href: "https://creator.xiaohongshu.com/publish/update", pathname: "/publish/update" }, () => ({ display: "block", visibility: "visible" })).media_count, 0);
  mediaArea.querySelectorAll = () => [media, decoy];
  body.parentElement = root;
  assert.equal(evaluate(document, { href: "https://creator.xiaohongshu.com/publish/update", pathname: "/publish/update" }, () => ({ display: "block", visibility: "visible" })).fields_matched, false);
  body.parentElement = editor;
  root.querySelectorAll = (selector: string) => selector === "input" ? [title, { ...title }, imageInput] : selector.includes("contenteditable") ? [body] : selector.includes('input[type="file"]') ? [imageInput] : [media];
  assert.equal(evaluate(document, { href: "https://creator.xiaohongshu.com/publish/update", pathname: "/publish/update" }, () => ({ display: "block", visibility: "visible" })).fields_matched, false);
});

test("#423 cleanup content ref is derived from the marker-bound page identity", () => {
  assert.equal(xhsContentRef("WE-XHS-E2E-1", "WE测试"), xhsContentRef("WE-XHS-E2E-1", "WE测试"));
  assert.notEqual(xhsContentRef("WE-XHS-E2E-1", "WE测试"), xhsContentRef("WE-XHS-E2E-2", "WE测试"));
  assert.notEqual(xhsContentRef("WE-XHS-E2E-1", "WE测试"), xhsContentRef("WE-XHS-E2E-1", "其他标题"));
});

test("#419 click response loss after mouse release dispatch remains unknown", async () => {
  const client = (failure: "before" | "release" | "none") => ({
    send: async (method: string, params: Record<string, unknown> = {}) => {
      if (failure === "before" && method === "Page.bringToFront") throw new Error("not sent");
      if (failure === "release" && method === "Input.dispatchMouseEvent" && params.type === "mouseReleased") throw new Error("response lost");
      return {};
    }
  });
  assert.equal(await clickPoint(client("before") as never, 10, 20), "not_dispatched");
  assert.equal(await clickPoint(client("release") as never, 10, 20), "unknown");
  assert.equal(await clickPoint(client("none") as never, 10, 20), "dispatched");
});

test("#423 published readback and cleanup select only the exact card actions", () => {
  const classList = (names: string[]) => ({ contains: (name: string) => names.includes(name) });
  const remove = { classList: classList(["note-card__action-btn--del"]), getBoundingClientRect: () => ({ left: 60, top: 10, width: 20, height: 20 }) };
  const edit = { classList: classList([]), getBoundingClientRect: () => ({ left: 30, top: 10, width: 20, height: 20 }) };
  const card = { querySelectorAll: () => [{ classList: classList([]) }, edit, remove] };
  const title = { children: [], textContent: "WE测试", getBoundingClientRect: () => ({ width: 100 }), closest: () => card };
  const editPoint = new Function("document", `return ${publishedActionPointExpression("WE测试", "edit")}`);
  const deletePoint = new Function("document", `return ${publishedActionPointExpression("WE测试", "delete")}`);
  assert.deepEqual(editPoint({ querySelectorAll: () => [title] }), { status: "matched", x: 40, y: 20 });
  assert.deepEqual(deletePoint({ querySelectorAll: () => [title] }), { status: "matched", x: 70, y: 20 });
});

test("#423 cleanup binds one update page and one confirmation inside the exact dialog", () => {
  const update = { id: "task", type: "page", title: "creator", url: "https://creator.xiaohongshu.com/publish/update?id=task" };
  const manager = { id: "manager", type: "page", title: "creator", url: "https://creator.xiaohongshu.com/new/note-manager" };
  assert.equal(selectCleanupPage([update, manager] as Parameters<typeof selectCleanupPage>[0])?.id, "task");
  assert.equal(selectCleanupPage([update, { ...update, id: "other" }] as Parameters<typeof selectCleanupPage>[0]), undefined);

  const managerLink = { textContent: "笔记管理", getBoundingClientRect: () => ({ left: 10, top: 20, width: 40, height: 20 }) };
  const navigate = new Function("document", `return ${noteManagerNavigationPointExpression()}`);
  assert.deepEqual(navigate({ querySelectorAll: () => [managerLink] }), { status: "matched", x: 30, y: 30 });
  assert.deepEqual(navigate({ querySelectorAll: () => [managerLink, managerLink] }), { status: "ambiguous" });

  const rect = { left: 30, top: 10, width: 20, height: 20 };
  const confirm = { disabled: false, innerText: "确定", textContent: "确定", getBoundingClientRect: () => rect };
  const exactDialog = {
    innerText: "删除笔记 删除后将无法恢复，确定要删除《WE测试0907-2》这篇笔记吗",
    textContent: "删除笔记 删除后将无法恢复，确定要删除《WE测试0907-2》这篇笔记吗",
    getBoundingClientRect: () => ({ ...rect, width: 200, height: 100 }),
    querySelectorAll: () => [confirm],
  };
  const unrelatedDialog = { ...exactDialog, innerText: "其他确认", textContent: "其他确认" };
  const exactTitle = { textContent: "WE测试0907-2214", getBoundingClientRect: () => ({ ...rect, width: 100 }) };
  const evaluate = new Function("document", "getComputedStyle", `return ${cleanupConfirmationPointExpression("WE测试0907-2214")}`);
  assert.deepEqual(evaluate(
    { querySelectorAll: (selector: string) => selector === ".note-card .note-card__title" ? [exactTitle] : [unrelatedDialog, exactDialog] },
    () => ({ display: "block", visibility: "visible" }),
  ), { status: "matched", x: 40, y: 20 });
  assert.deepEqual(evaluate(
    { querySelectorAll: (selector: string) => selector === ".note-card .note-card__title" ? [exactTitle, { ...exactTitle, textContent: "WE测试0907-2999" }] : [exactDialog] },
    () => ({ display: "block", visibility: "visible" }),
  ), { status: "ambiguous" });
});

test("#419 same-route draft overlay reopens the newest exact-title draft", () => {
  const rect = (top: number, left = 0, width = 100, height = 20) => ({ top, left, width, height, right: left + width, bottom: top + height });
  const body = { textContent: "", children: [], parentElement: null };
  const card = (top: number) => {
    const edit = { textContent: "编辑", children: [], parentElement: null as unknown, getBoundingClientRect: () => rect(top + 20, 30, 20, 20) };
    const remove = { textContent: "删除", children: [], parentElement: null as unknown, getBoundingClientRect: () => rect(top + 20, 60, 20, 20) };
    const title = { textContent: "WE测试", children: [], parentElement: null as unknown, getBoundingClientRect: () => rect(top) };
    const entry = {
      textContent: "WE测试 编辑 删除",
      children: [title, edit, remove],
      parentElement: body,
      getBoundingClientRect: () => rect(top, 0, 120, 50),
      querySelectorAll: () => [edit, remove]
    };
    title.parentElement = entry;
    edit.parentElement = entry;
    remove.parentElement = entry;
    return { title, entry };
  };
  const latest = card(10);
  const older = card(100);
  const evaluate = new Function("document", "getComputedStyle", `return ${draftEditPointExpression("WE测试")}`);
  assert.deepEqual(evaluate(
    { body, querySelectorAll: () => [older.title, latest.title] },
    () => ({ display: "block", visibility: "visible" })
  ), { status: "matched", x: 40, y: 40 });
});

test("#412 field fill blocks every outbound mutation while media upload keeps its bounded network path", () => {
  assert.equal(blocksXhsMediaActionRequest("xhs_publish_note_image_text_fields.compose", "POST", "https://creator.xiaohongshu.com/api/opaque"), true);
  assert.equal(blocksXhsMediaActionRequest("xhs_publish_note_image_text_fields.compose", "GET", "https://creator.xiaohongshu.com/api/opaque"), false);
  assert.equal(blocksXhsMediaActionRequest("xhs_publish_note_image_text_media.image_upload", "POST", "https://creator.xiaohongshu.com/api/upload"), false);
  assert.equal(blocksXhsMediaActionRequest("xhs_publish_note_image_text_media.image_upload", "POST", "https://creator.xiaohongshu.com/api/publish"), true);
  assert.equal(blocksXhsMediaActionRequest("xhs_publish_note_image_text_commit.save_draft", "POST", "https://creator.xiaohongshu.com/api/save"), false);
  assert.equal(blocksXhsMediaActionRequest("xhs_publish_note_image_text_commit.publish", "POST", "https://creator.xiaohongshu.com/api/publish"), false);
});

test("#412 field fill writes only one visible app-owned title and body and returns match states", () => {
  class TestInput {
    hidden = false;
    disabled = false;
    readOnly = false;
    private currentValue = "";
    get value() { return this.currentValue; }
    set value(value: string) { this.currentValue = value; }
    getAttribute(name: string) { return name === "placeholder" ? "填写标题" : null; }
    closest() { return null; }
    getBoundingClientRect() { return { width: 100, height: 20, right: 100, bottom: 20, left: 0, top: 0 }; }
    checkVisibility() { return true; }
    dispatchEvent() { return true; }
  }
  class TestBody {
    hidden = false;
    textContent = "";
    get innerText() { return this.textContent; }
    getAttribute() { return null; }
    closest() { return null; }
    getBoundingClientRect() { return { width: 100, height: 100, right: 100, bottom: 100, left: 0, top: 0 }; }
    checkVisibility() { return true; }
    focus() {}
    dispatchEvent() { return true; }
  }
  const title = new TestInput();
  const body = new TestBody();
  const root = { querySelectorAll: (selector: string) => selector === "input" ? [title] : [body] };
  const document = {
    querySelectorAll: () => [root],
    createRange: () => ({ selectNodeContents() {} }),
    execCommand: () => false
  };
  const evaluate = new Function(
    "document", "getComputedStyle", "innerWidth", "innerHeight", "HTMLInputElement", "Event", "InputEvent", "getSelection",
    `return ${fieldFillProbeExpression("测试标题", "测试正文", true)}`
  );
  const result = evaluate(
    document,
    () => ({ display: "block", visibility: "visible", pointerEvents: "auto", opacity: "1" }),
    200,
    200,
    TestInput,
    class { constructor(_name: string, _options: unknown) {} },
    class { constructor(_name: string, _options: unknown) {} },
    () => ({ removeAllRanges() {}, addRange() {} })
  );
  assert.deepEqual(result, { title_candidate_count: 1, body_candidate_count: 1, title_matched: true, body_matched: true });
  assert.equal(title.value, "测试标题");
  assert.equal(body.textContent, "测试正文");
  const expression = fieldFillProbeExpression("x", "y", false);
  assert.match(expression, /#app, \[data-v-app\]/);
  assert.doesNotMatch(expression, /保存草稿|发布笔记|click\(\)/);
});

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

test("creator publish URL accepts only the two page-proven bounded redirects", () => {
  const target = "https://creator.xiaohongshu.com/publish/publish";
  assert.equal(sameWritePrecheckUrl(`${target}?from=tab_switch`, target), true);
  assert.equal(sameWritePrecheckUrl(`${target}?from=menu_left&target=image`, target), true);
  assert.equal(sameWritePrecheckUrl(`${target}?from=other`, target), false);
  assert.equal(sameWritePrecheckUrl(`${target}?from=tab_switch&extra=1`, target), false);
  assert.equal(sameWritePrecheckUrl(`${target}?from=menu_left&target=video`, target), false);
  assert.equal(sameWritePrecheckUrl(`${target}?from=menu_left&target=image&extra=1`, target), false);
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
  assert.equal(selectPage([explore, { ...creator, url: `${requestedUrl}/?from=tab_switch` }], requestedUrl)?.id, "creator");
  assert.equal(selectPage([explore, { ...creator, url: `${requestedUrl}?from=other` }], requestedUrl), undefined);
  assert.equal(selectPage([explore, { ...creator, url: `${requestedUrl}/?from=other` }], requestedUrl), undefined);
});

test("selectPage prefers the bounded creator image-text redirect over stale exact video tabs", () => {
  const requestedUrl = "https://creator.xiaohongshu.com/publish/publish";
  const exact = { id: "video", type: "page", url: requestedUrl, webSocketDebuggerUrl: "ws://video" };
  const imageText = { id: "image-text", type: "page", url: `${requestedUrl}?from=tab_switch`, webSocketDebuggerUrl: "ws://image-text" };
  assert.equal(selectPage([exact, imageText], requestedUrl)?.id, "image-text");
});

test("selectPage keeps a bound creator composition target across follow-up operations", () => {
  const requestedUrl = "https://creator.xiaohongshu.com/publish/publish?from=menu_left&target=image";
  const empty = { id: "empty", type: "page", url: requestedUrl, webSocketDebuggerUrl: "ws://empty" };
  const composition = { id: "composition", type: "page", url: requestedUrl, webSocketDebuggerUrl: "ws://composition" };

  assert.equal(selectPage([empty, composition], requestedUrl, "composition")?.id, "composition");
  assert.equal(selectPage([empty, composition], requestedUrl, "missing")?.id, "empty");
});

test("selectPage adopts the page-proven image composition route over a bound empty entrypoint", () => {
  const requestedUrl = "https://creator.xiaohongshu.com/publish/publish";
  const empty = { id: "bound", type: "page", url: requestedUrl, webSocketDebuggerUrl: "ws://empty" };
  const composition = { id: "composition", type: "page", url: `${requestedUrl}?from=menu_left&target=image`, webSocketDebuggerUrl: "ws://composition" };

  assert.equal(selectPage([empty, composition], requestedUrl, "bound")?.id, "composition");
});

test("selectPage ignores a bound target after it leaves the requested creator page", () => {
  const requestedUrl = "https://creator.xiaohongshu.com/publish/publish?from=menu_left&target=image";
  const matching = { id: "matching", type: "page", url: requestedUrl, webSocketDebuggerUrl: "ws://matching" };
  const drifted = { id: "bound", type: "page", url: "https://www.xiaohongshu.com/explore", webSocketDebuggerUrl: "ws://bound" };

  assert.equal(selectPage([drifted, matching], requestedUrl, "bound")?.id, "matching");
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
  assert.match(upload, /button, \[role="button"\], \[role="tab"\], \.header-tabs \.creator-tab/);
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

for (const isDecoy of [false, true]) test(`#405 path probe ${isDecoy ? "rejects a decoy" : "awaits observation and selects one visible path"}`, async () => {
  let clicks = 0;
  const app = {
    hidden: false,
    contains: () => true,
    closest: () => null,
    getBoundingClientRect: () => ({ width: 100, height: 100, right: 100, bottom: 100, left: 0, top: 0 }),
    checkVisibility: () => true,
    querySelectorAll: (selector: string): object[] => selector.startsWith('[id*="publish"]') ? [app] : []
  };
  const decoy = {
    disabled: false,
    hidden: false,
    textContent: "上传图文",
    getAttribute: () => null,
    closest: (selector: string) => isDecoy && selector.includes('[data-testid*="decoy"]') ? {} : null,
    getBoundingClientRect: () => ({ width: 20, height: 20, right: 21, bottom: 21, left: 1, top: 1 }),
    checkVisibility: () => true,
    querySelector: () => null,
    click: () => { clicks += 1; }
  };
  const document = {
    body: { innerText: "" },
    querySelector: () => app,
    querySelectorAll: (selector: string) => selector === "#app, [data-v-app]" ? [app] : selector.includes("login") ? [] : [decoy]
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
  assert.equal(clicks, isDecoy ? 0 : 1);
  assert.equal(result.selection_status, isDecoy ? "unknown" : "selected");
});

test("#419 precheck observes the public host contract for closed-shadow draft and publish controls", async () => {
  const element = (label: string, attributes: Record<string, string> = {}) => ({
    className: attributes.class ?? "",
    disabled: false,
    hidden: false,
    readOnly: false,
    textContent: label,
    naturalWidth: 100,
    naturalHeight: 100,
    get currentSrc() { return attributes.src ?? ""; },
    contains: () => true,
    closest: () => null,
    getAttribute: (name: string) => attributes[name] ?? null,
    getBoundingClientRect: () => ({ width: 100, height: 40, right: 100, bottom: 100, left: 0, top: 0 }),
    checkVisibility: () => true,
    querySelectorAll: () => []
  });
  const title = { ...element("", { placeholder: "填写标题" }), value: "Original" };
  const body = element("test body", { contenteditable: "true" });
  const firstImage = element("", { src: "blob:https://creator.xiaohongshu.com/first-preview" });
  const secondImage = element("", { src: "https://ci.xiaohongshu.com/second-preview.webp" });
  const imageElements = [firstImage, secondImage];
  const imageComposition = {
    ...element("图片编辑 1/18"),
    querySelectorAll: (selector: string) => selector === "img" ? imageElements : []
  };
  const hostAttributes: Record<string, string> = {
    "is-publish": "true",
    "is-save-draft": "true",
    "submit-text": "发布",
    "save-text": "暂存离开",
    "submit-disabled": "false",
    "save-disabled": "false"
  };
  const publishHost = element("", hostAttributes);
  const accountName = element("Marchen");
  const accountRoot = { ...element("Marchen"), querySelectorAll: (selector: string) => selector === ".name-box" ? [accountName] : [] };
  const imageCompositions = [imageComposition];
  const controls = [title, body];
  let showPublishHost = true;
  let extraCreatorRoot: object | undefined;
  let missingCreatorRoot = false;
  const app = {
    ...element(""),
    __vue_app__: { config: { globalProperties: { $store: { state: { Auth: { userInfo: { userId: "user-123", userName: "Marchen" } } } } } } },
    querySelectorAll: (selector: string) => selector === "xhs-publish-btn" ? (showPublishHost ? [publishHost] : [])
      : selector === ".publish-page-content-media" ? imageCompositions
      : selector === ".user-info" ? [accountRoot]
      : selector === "input" ? controls.filter((el) => el.getAttribute("placeholder") === "填写标题")
      : selector === '[contenteditable="true"]' ? controls.filter((el) => el.getAttribute("contenteditable") === "true")
      : selector.includes("aria-invalid") || missingCreatorRoot ? [] : extraCreatorRoot ? [app, extraCreatorRoot] : [app]
  };
  const appRoots = [app];
  const document = {
    body: { innerText: "" },
    querySelector: () => app,
    querySelectorAll: (selector: string) => selector === "#app, [data-v-app]" ? appRoots : selector.includes("login") ? [] : controls
  };
  const evaluate = new Function(
    "document", "location", "getComputedStyle", "innerWidth", "innerHeight", "setTimeout",
    `return ${writePrecheckProbeExpression("image_text_upload")}`
  );
  const location = { href: "https://creator.xiaohongshu.com/publish/publish?from=tab_switch", origin: "https://creator.xiaohongshu.com", pathname: "/publish/publish" };
  const result = await evaluate(
    document,
    location,
    () => ({ display: "block", visibility: "visible", pointerEvents: "auto", opacity: "1", zIndex: "0" }),
    1200,
    800,
    (resolve: () => void) => resolve()
  );
  assert.equal(result.field_states.content_editor.observation, "observed");
  assert.equal(result.path_observed, "observed");
  assert.equal(result.media_state.observation, "observed");
  assert.equal(result.save_draft_control.availability, "available");
  assert.equal(result.publish_control.availability, "available");
  assert.equal(result.composition_state, "composition_initialized");
  assert.equal(result.public_observation.account_source_kind, "xiaohongshu.creator_auth_store.user_info/v1");
  assert.deepEqual(result.public_observation.account_candidates, [{ label: "Marchen", stable_id: "user-123" }]);
  assert.equal(result.public_observation.business_target_kind, "xiaohongshu.creator_publish_page/v1");
  assert.equal(result.public_observation.media_source_kind, "xiaohongshu.creator_publish_page.preview_image_source/v1");
  assert.equal(result.public_observation.ordered_item_refs.length, 2);
  assert.equal(new Set(result.public_observation.ordered_item_refs).size, 2);
  assert.equal(result.public_observation.ordered_item_refs.every((ref: string) => /^media:sha256:[a-f0-9]{64}$/.test(ref)), true);

  const observeFields = () => evaluate(document, location, () => ({ display: "block", visibility: "visible", pointerEvents: "auto", opacity: "1", zIndex: "0" }), 1200, 800, (resolve: () => void) => resolve());
  controls.unshift(element("标题帮助"), element("正文帮助"));
  const withHelp = await observeFields();
  assert.equal(withHelp.public_observation.page_fingerprint, result.public_observation.page_fingerprint);
  title.value = "Changed";
  const changedTitle = await observeFields();
  assert.notEqual(changedTitle.public_observation.page_fingerprint, withHelp.public_observation.page_fingerprint);
  body.textContent = "Changed body";
  assert.notEqual((await observeFields()).public_observation.page_fingerprint, changedTitle.public_observation.page_fingerprint);
  controls.push({ ...title });
  assert.equal((await observeFields()).field_states.title_input.observation, "unknown");
  controls.pop();
  controls.splice(0, 2);
  title.value = "Original";
  body.textContent = "test body";

  imageElements.reverse();
  const reordered = await evaluate(document, location, () => ({ display: "block", visibility: "visible", pointerEvents: "auto", opacity: "1", zIndex: "0" }), 1200, 800, (resolve: () => void) => resolve());
  assert.deepEqual(reordered.public_observation.ordered_item_refs, [...result.public_observation.ordered_item_refs].reverse());
  assert.notEqual(reordered.public_observation.page_fingerprint, result.public_observation.page_fingerprint);

  delete hostAttributes["submit-disabled"];
  const missingDisabled = await evaluate(document, location, () => ({ display: "block", visibility: "visible", pointerEvents: "auto", opacity: "1", zIndex: "0" }), 1200, 800, (resolve: () => void) => resolve());
  assert.equal(missingDisabled.publish_control.observation, "unknown");

  hostAttributes["submit-disabled"] = "false";
  controls.push(element("other body", { contenteditable: "true" }));
  const ambiguousBody = await evaluate(document, location, () => ({ display: "block", visibility: "visible", pointerEvents: "auto", opacity: "1", zIndex: "0" }), 1200, 800, (resolve: () => void) => resolve());
  assert.equal(ambiguousBody.field_states.content_editor.observation, "unknown");
  // A default video tab is still the same authenticated creator-page target.
  // It does not prove that image composition, media or fields are ready.
  const videoAttributes = { "aria-selected": "true" };
  const imageAttributes = { "aria-selected": "false" };
  const videoTab = element("上传视频", videoAttributes);
  const imageTab = element("上传图文", imageAttributes);
  controls.splice(0, controls.length, videoTab, imageTab);
  imageCompositions.length = 0;
  showPublishHost = false;
  const read = () => evaluate(document, location, () => ({ display: "block", visibility: "visible", pointerEvents: "auto", opacity: "1", zIndex: "0" }), 1200, 800, (resolve: () => void) => resolve());
  const video = await read();
  assert.equal(video.public_observation.business_target_kind, "xiaohongshu.creator_publish_page/v1");
  assert.equal(video.path_observed, "unobserved");
  assert.equal(video.composition_state, "composition_unknown");
  assert.equal(video.public_observation.image_count, null);
  assert.equal(video.field_states.title_input.observation, "unknown");
  const target = validateXhsWritePrecheckObservation({ target_url: location.href, expected_origin: "https://creator.xiaohongshu.com", target_ref: "target_test", expected: { business_target_ref: "target:sha256:c9c53848257e15f50166830b48c959fd83f9f72824cf0a5b6d783b19f6405f3c" } }, video);
  assert.equal(target.status, "completed");
  if (target.status === "completed") {
    assert.equal(target.public_observation.business_target.status, "observed");
    assert.equal(target.public_observation.business_target.expected_match, "matched");
  }
  videoAttributes["aria-selected"] = "false";
  imageAttributes["aria-selected"] = "true";
  const image = await read();
  assert.notEqual(image.public_observation.page_fingerprint, video.public_observation.page_fingerprint);
  assert.equal(image.public_observation.business_target_kind, video.public_observation.business_target_kind);
  controls.push(title);
  assert.notEqual((await read()).public_observation.page_fingerprint, image.public_observation.page_fingerprint);
  controls.pop();
  accountName.textContent = "Different account";
  assert.equal((await read()).public_observation.business_target_kind, null);
  accountName.textContent = "Marchen";
  location.origin = "https://example.test";
  assert.equal((await read()).public_observation.business_target_kind, null);
  location.origin = "https://creator.xiaohongshu.com";
  location.pathname = "/other";
  assert.equal((await read()).public_observation.business_target_kind, null);
  location.pathname = "/publish/publish";
  missingCreatorRoot = true;
  assert.equal((await read()).public_observation.business_target_kind, null);
  missingCreatorRoot = false;
  // Nested Vue mounts belong to the same ownership tree, unlike disjoint Apps.
  const nestedApp = { ...app, contains: () => false };
  appRoots.push(nestedApp);
  assert.equal((await read()).public_observation.business_target_kind, "xiaohongshu.creator_publish_page/v1");
  appRoots.pop();
  const disjointApp = { ...app, contains: () => false };
  const appContains = app.contains;
  app.contains = (node?: unknown) => node !== disjointApp;
  appRoots.push(disjointApp);
  assert.equal((await read()).public_observation.business_target_kind, null);
  appRoots.pop();
  app.contains = appContains;
  // Distinct candidate surfaces must not be collapsed to the first match.
  const previousContains = app.contains;
  extraCreatorRoot = { ...element(""), contains: (node: unknown) => controls.includes(node as typeof title) };
  app.contains = (node?: unknown) => node !== extraCreatorRoot;
  assert.equal((await read()).public_observation.business_target_kind, null);
  extraCreatorRoot = undefined;
  app.contains = previousContains;
  app.closest = () => ({} as never);
  assert.equal((await read()).public_observation.business_target_kind, null);

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
  assert.match(probe, /\[aria-disabled=\\?"true\\?"\].*\[data-decoy\].*\[data-testid\*=\\?"decoy\\?"\].*\.decoy/);
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
  assert.match(probe, /\[aria-hidden=\\?"true\\?"\].*\[hidden\].*\[data-decoy\].*\[data-testid\*=\\?"decoy\\?"\].*\.decoy/);
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
  assert.equal(validateXhsWritePrecheckObservation(
    { ...input, target_url: `${input.target_url}/` },
    { ...base, url: `${base.url}/`, pathname: "/publish/publish/" }
  ).status, "completed");
});

test("managed launch rejects mixed provider, installation and Profile before launching", async () => {
  const { createLocalIdentityEnvironmentFacts } = await import("./identity-environment.js");
  const { launchLocalDedicatedProvider } = await import("./local-provider-launcher.js");
  const path = "/fixture/chrome";
  const identity = createLocalIdentityEnvironmentFacts({
    identity_environment_ref: "identity-binding-regression",
    requested_provider_id: "chrome_official",
    site: { site_id: "xiaohongshu", origin: "https://www.xiaohongshu.com", display_name: "小红书" },
    env: { HARBOR_CHROME_PATH: path }, platform: "darwin", arch: "arm64",
    path_exists: (candidate) => candidate === path,
    is_executable: (candidate) => candidate === path,
    read_text: () => null, list_dir: () => []
  });
  assert.equal(identity.provider_binding.selected_provider_id, "chrome_official");
  const input = {
    browser_path: path, headless: true, timeout_ms: 1, url: "about:blank",
    profile_ref: identity.profile_ref, provider_ref: "provider-binding-regression",
    profile_storage_ref: identity.browser_storage.profile_storage_ref,
    identity_environment: identity
  };
  const guarded = await launchLocalDedicatedProvider({ ...input, operation_scope: "profile_management" });
  assert.ok(guarded.status === "unavailable" && guarded.error.code === "provider_unavailable");
  for (const mismatch of [
    { provider_id: "camoufox" as const },
    { browser_path: "/fixture/camoufox" },
    { profile_storage_ref: "other-profile" }
  ]) {
    const result = await launchLocalDedicatedProvider({ ...input, ...mismatch });
    assert.equal(result.status, "unavailable");
    if (result.status !== "unavailable") throw new Error("Unexpected launch");
    assert.equal(result.error.code, "identity_environment_unavailable");
    assert.equal(result.facts.some((fact) => fact.value === "provider_mismatch"), true);
  }
});
